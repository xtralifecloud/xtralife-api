'use strict';

const async = require('async');
const EventEmitter = require('events');

const ST = {
  CLOSED: 0,
  CONNECTED: 1,
  LOADING: 2,
  READY: 3
};

class Lured extends EventEmitter {
  constructor(redisClient, scripts) {
    super();
    if (!redisClient || typeof redisClient !== 'object') {
      throw new Error('Invalid redis client');
    }
    if (!scripts || typeof scripts !== 'object') {
      throw new Error('Invalid scripts');
    }
    this._client = redisClient;
    this._scripts = scripts;

    // Initial state
    this._state = ST.CONNECTED;

    redisClient.on('end', (err) => {
      console.log("--> err", err);
      let ps = this._state;
      this._state = ST.CLOSED;
      if (ps !== this._state) {
        this.emit('state', ps, this._state);
      }
    });

    redisClient.on('error', (err) => {
      // to avoid exit on error.
    });
  }

  load(options, cb) {
    let tasks = [];
    let lastErr;

    if (typeof options !== 'object') {
      cb = options;
      options = {};
    }

    Object.keys(this._scripts).forEach((k) => {
      let v = this._scripts[k];
      if (!v.script || typeof v.script !== 'string') {
        lastErr = new Error('Invalid script for ' + k);
        return;
      }
      tasks.push((next) => {
        if (options.force) {
          this._load(v.script,  (err, newSha) => {
            if (err) {
              lastErr = err;
            }
            v.sha = newSha;
            next();
          });
          return;
        }

        if (!v.sha || typeof v.sha !== 'string') {
          v.sha = require('crypto').createHash("sha1").update(v.script).digest("hex");
        }

        this._exists(v.sha,  (err, exist) => {
          if (exist) {
            return void (next());
          }
          this._load(v.script,  (err, newSha) => {
            if (err) {
              lastErr = err;
            }
            v.sha = newSha;
            next();
          });
        });
      });
    });
    async.series(tasks, () => {
      let ps = this._state;
      if (lastErr) {
        if (this._client.connected) {
          this._state = ST.CONNECTED;
        } else {
          this._state = ST.CLOSED;
        }
      } else {
        this._state = ST.READY;
      }
      if (ps !== this._state) {
        this.emit('state', ps, this._state);
      }
      cb(lastErr);
    });
    let ps = this._state;
    this._state = ST.LOADING;
    if (ps !== this._state) {
      this.emit('state', ps, this._state);
    }
  }

  async _exists(sha, cb) {
    const replies = await this._client.SCRIPT_EXISTS(sha).catch(err => cb(err));
    return cb(null, replies[0]);
  }

  async _load(script, cb) {
    const sha = await this._client.SCRIPT_LOAD(script).catch(err => cb(err));
    if (sha.indexOf("ERR") >= 0) {
      return cb(new Error(sha));
    }
    cb(null, sha);
  }
}

exports.create = (redisClient, scripts) => {
  return new Lured(redisClient, scripts);
};
