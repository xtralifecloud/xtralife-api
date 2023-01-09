"use strict";

const fs = require("fs");
const debug = require("debug")("dtimer");
const uuidv4 = require("uuid").v4;
const EventEmitter = require('events');


let updateLua;
let cancelLua;
let changeDelayLua;

// defaults
const defaults = {
  ns: "dt",
  maxEvents: 8,
  readyTimeout: 30, // in seconds
  confTimeout: 10, // in seconds
};

// Workaround for in-result errors for multi operation.
// This will not be necessary with redis@>=2.0.0.
const throwIfMultiError = results => {
  results.forEach(res => {
    const error = res[0];
    if (error != null) {
      throw new Error(error);
    }
  });
}

// Redis key name policy
// Global hash: $ns + ':' + 'gl', hash {field-name, value}
//    o lastId
// Channel table    : $ns + ':' + 'chs', hash-set {last-ts, node-id}
// Event table   : $ns + ':' + 'evs', hash {field-name, value}

class DTimer extends EventEmitter {

  constructor(id, pub, sub, option) {
    super()
    this._timer = null;
    this._option = Object.assign({}, defaults, option || {});
    this._pub = pub;
    if (!this._pub) {
      throw new Error("Redis client (pub) is missing");
    }

    updateLua ??= fs.readFileSync(__dirname + "/lua/update.lua", "utf8");
    cancelLua ??= fs.readFileSync(__dirname + "/lua/cancel.lua", "utf8");
    changeDelayLua ??= fs.readFileSync(__dirname + "/lua/changeDelay.lua", "utf8");

    this._pub.defineCommand("update", {
      numberOfKeys: 5,
      lua: updateLua,
    });

    this._pub.defineCommand("cancel", {
      numberOfKeys: 2,
      lua: cancelLua,
    });

    this._pub.defineCommand("changeDelay", {
      numberOfKeys: 1,
      lua: changeDelayLua,
    });

    this._sub = sub;
    if (this._sub) {
      this._sub.on("message", this._onSubMessage.bind(this));
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("The id must be non-empty string");
      }
    } else {
      id = "post-only";
    }
    this._keys = {
      gl: "{" + this._option.ns + "}" + ":gl",
      ch: "{" + this._option.ns + "}" + ":ch",
      ei: "{" + this._option.ns + "}" + ":ei",
      ed: "{" + this._option.ns + "}" + ":ed",
      et: "{" + this._option.ns + "}" + ":et",
    };
    this._id = this._keys.ch + ":" + id; // subscriber channel
    this._maxEvents = this._option.maxEvents;
  }

  setMaxEvents(num) {
    this._maxEvents = (num > 0) ? num : this._option.maxEvents;
  }

  _onSubMessage(_chId, msg) {
    try {
      const o = JSON.parse(msg);
      if (typeof o.interval === "number") {
        if (this._timer) {
          clearTimeout(this._timer);
        }
        debug(this._id + ": new interval (1) " + o.interval);
        this._timer = setTimeout(this._onTimeout.bind(this), o.interval);
      }
    } catch (e) {
      debug("Malformed message:", msg);
      this.emit("error", e);
    }
  }

  async join() {
    if (!this._sub) {
      throw new Error("Can not join without redis client (sub)");
    }

    await this._sub.subscribe(this._id);
    const now = await this._redisTime();

    const replies = await this._pub
      .multi()
      .lrem(this._keys.ch, 0, this._id)
      .lpush(this._keys.ch, this._id)
      .update(
        this._keys.gl,
        this._keys.ch,
        this._keys.ei,
        this._keys.ed,
        this._keys.et,
        "",
        now,
        0,
        this._option.confTimeout
      )
      .exec()

    throwIfMultiError(replies);

    if (this._timer) {
      clearTimeout(this._timer);
    }
    debug(this._id + ": new interval (2) " + replies[2][1][1]);
    this._timer = setTimeout(
      this._onTimeout.bind(this),
      replies[2][1][1]
    );
  }

  async _redisTime() {
    const result = await this._pub.time();
    return result[0] * 1000 + Math.floor(result[1] / 1000);
  }

  async leave() {
    if (!this._sub) {
      throw new Error("Can not leave without redis client (sub)")
    }

    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    const now = await this._redisTime();

    try {
      const results = await this._pub
        .multi()
        .lrem(this._keys.ch, 0, this._id)
        .update(
          this._keys.gl,
          this._keys.ch,
          this._keys.ei,
          this._keys.ed,
          this._keys.et,
          "",
          now,
          0,
          this._option.confTimeout
        )
        .exec()

      throwIfMultiError(results);
    } finally {
      await this._sub.unsubscribe(this._id);
    }
  }

  async post(ev, delay) {
    if (typeof delay !== "number") {
      throw new Error("delay argument must be of type number");
    }

    ev = JSON.parse(JSON.stringify(ev));

    if (typeof ev !== "object") {
      throw new Error("event data must be of type object");
    }

    if (Object.hasOwn(ev, "id")) {
      if (typeof ev.id !== "string" || ev.id.length === 0) {
        throw new Error("event ID must be a non-empty string");
      }
    } else {
      ev.id = uuidv4();
    }
    const evId = ev.id;

    if (Object.hasOwn(ev, "maxRetries")) {
      if (typeof ev.maxRetries !== "number") {
        throw new Error("maxRetries must be a number");
      }
    } else {
      ev.maxRetries = 0;
    }

    const msg = JSON.stringify(ev);

    const now = await this._redisTime();

    const results = await this._pub
      .multi()
      .zadd(this._keys.ei, now + delay, evId)
      .hset(this._keys.ed, evId, msg)
      .update(
        this._keys.gl,
        this._keys.ch,
        this._keys.ei,
        this._keys.ed,
        this._keys.et,
        "",
        now,
        0,
        this._option.confTimeout
      )
      .exec();

    throwIfMultiError(results);
    return evId;
  }

  async peek(evId) {
    const results = await this._pub
      .multi()
      .zscore(this._keys.ei, evId)
      .hget(this._keys.ed, evId)
      .exec()

    throwIfMultiError(results);
    if (results[0][1] === null || results[1][1] === null) {
      return [null, null];
    }

    const now = await this._redisTime();
    return [
      Math.max(parseInt(results[0][1]) - now, 0),
      JSON.parse(results[1][1]),
    ];
  }

  async cancel(evId) {
    const now = await this._redisTime();
    const results = await this._pub
      .multi()
      .cancel(this._keys.ei, this._keys.ed, evId)
      .update(
        this._keys.gl,
        this._keys.ch,
        this._keys.ei,
        this._keys.ed,
        this._keys.et,
        "",
        now,
        0,
        this._option.confTimeout
      )
      .exec()

    throwIfMultiError(results);
    return results[0][1];
  }

  async confirm(evId) {
    const now = await this._redisTime();
    const results = await this._pub
      .multi()
      .cancel(this._keys.et, this._keys.ed, evId)
      .update(
        this._keys.gl,
        this._keys.ch,
        this._keys.ei,
        this._keys.ed,
        this._keys.et,
        "",
        now,
        0,
        this._option.confTimeout
      )
      .exec()

    throwIfMultiError(results);
    return results[0][1];
  }

  async changeDelay(evId, delay) {
    if (typeof delay !== "number") {
      throw new Error("delay argument must be of type number");
    }

    const now = await this._redisTime();
    const results = await this._pub
      .multi()
      .changeDelay(this._keys.ei, evId, now + delay)
      .update(
        this._keys.gl,
        this._keys.ch,
        this._keys.ei,
        this._keys.ed,
        this._keys.et,
        "",
        now,
        0,
        this._option.confTimeout
      )
      .exec()

    throwIfMultiError(results);
    return results[0][1];
  }


  async _onTimeout() {
    this._timer = null;
    let interval;

    try {
      const now = await this._redisTime();
      const replies = await this._pub
        .update(
          this._keys.gl,
          this._keys.ch,
          this._keys.ei,
          this._keys.ed,
          this._keys.et,
          this._id,
          now,
          this._maxEvents,
          this._option.confTimeout
        )
      interval = replies[1];
      if (replies[0].length > 0) {
        replies[0].forEach(sev => {
          let ev;
          try {
            ev = JSON.parse(sev);
          } catch (e) {
            debug(this._id + ": fail to parse event. " + JSON.stringify(e));
            return;
          }
          this.emit("event", ev);
        });
      }
    } catch (err) {
      interval = 3000;
      debug(this._id + ": update failed: " + err.name);
      this.emit("error", err);
    } finally {
      if (!this._timer) {
        debug(this._id + ": new interval (3) " + interval);
        this._timer = setTimeout(this._onTimeout.bind(this), interval);
      }
    }
  }

  async upcoming(option = {}) {
    const defaults = {
      offset: -1,
      duration: -1, // +inf
      limit: -1, // +inf
    };

    const _option = Object.assign({}, defaults, option);
    let args = [this._keys.ei];
    let offset = 0;

    const now = await this._redisTime();
    if (typeof _option.offset !== "number" || _option.offset < 0) {
      args.push(0);
    } else {
      args.push(now + _option.offset);
      offset = _option.offset;
    }
    if (typeof _option.duration !== "number" || _option.duration < 0) {
      args.push("+inf");
    } else {
      args.push(now + offset + _option.duration);
    }
    args.push("WITHSCORES");
    if (typeof _option.limit === "number" && _option.limit > 0) {
      args.push("LIMIT");
      args.push(0);
      args.push(_option.limit);
    }
    debug("upcoming args: " + JSON.stringify(args));

    let results = await this._pub.zrangebyscore(args);

    if (results.length === 0) {
      return {};
    }

    const out = [];
    args = [this._keys.ed];
    for (let i = 0; i < results.length; i += 2) {
      out.push({ expireAt: parseInt(results[i + 1]), id: results[i] });
      args.push(results[i]);
    }

    results = await this._pub.hmget(args);
    const outObj = {};
    let event;
    results.forEach((evStr, index) => {
      if (!evStr) {
        return;
      }
      try {
        event = JSON.parse(evStr);
      } catch (e) {
        debug(this._id + ": fail to parse event. " + JSON.stringify(e));
        return;
      }
      outObj[out[index].id] = {
        expireAt: out[index].expireAt,
        event: event,
      };
    });

    return outObj;
  }
}

module.exports.DTimer = DTimer;
