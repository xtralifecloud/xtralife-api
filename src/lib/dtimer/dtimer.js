'use strict';

const fs = require('fs');
const EventEmitter = require('events');
const _und = require('underscore');
const debug = require('debug')('dtimer');
const uuid = require('uuid');

// defaults
let defaults = {
  ns: 'dt',
  maxEvents: 8,
  readyTimeout: 30, // in seconds
  confTimeout: 10 // in seconds
};

// scripts
let scripts = {
  update: {
    script: fs.readFileSync(__dirname + '/lua/update.lua', 'utf8')
  },
  cancel: {
    script: fs.readFileSync(__dirname + '/lua/cancel.lua', 'utf8')
  },
  changeDelay: {
    script: fs.readFileSync(__dirname + '/lua/changeDelay.lua', 'utf8')
  }
};

// Workaround for in-result errors for multi operation.
// This will not be necessary with redis@>=2.0.0.
const throwIfMultiError = results => {
  results.forEach(res => {
    if (typeof res === 'string' && res.indexOf('ERR') === 0) {
      throw new Error(res);
    }
  });
}

// Redis key name policy
// Global hash: $ns + ':' + 'gl', hash {field-name, value}
//    o lastId
// Channel table    : $ns + ':' + 'chs', hash-set {last-ts, node-id}
// Event table   : $ns + ':' + 'evs', hash {field-name, value}

class ClassDTimer extends EventEmitter {
  constructor(id, pub, sub, option) {
    super();
    this._timer = null;
    this._option = _und.defaults(option || {}, defaults);
    this._pub = pub;
    if (!this._pub) {
      throw new Error('Redis client (pub) is missing');
    }
    this._sub = sub;
    if (this._sub) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('The id must be non-empty string');
      }
    } else {
      id = 'post-only';
    }
    this._keys = {
      gl: this._option.ns + ':gl',
      ch: this._option.ns + ':ch',
      ei: this._option.ns + ':ei',
      ed: this._option.ns + ':ed',
      et: this._option.ns + ':et'
    };
    this._id = this._keys.ch + ':' + id; // subscriber channel
    this._lur = require('./lured').create(this._pub, scripts);
    this._lur.load((err) => {
      if (err) {
        debug(this._id + ': lua loading failed: ' + err.name);
        this.emit('error', err);
        return;
      }
      debug(this._id + ': lua loading successful');
    });
    this._maxEvents = this._option.maxEvents;
  }

  maxEvents() {
    return this._maxEvents;
  }

  setMaxEvents(num) {
    this._maxEvents = (num > 0) ? num : this._option.maxEvents;
  }

  _redisTime() {
    return this._pub.TIME()
      .then((result) => {
        return result.getTime() + Math.floor(result.microseconds / 1000);
      })
      .catch(e => this.emit('error', e));
  };

  _onSubMessage(msg, chId) {
    void (chId);
    try {
      let o = JSON.parse(msg);
      if (typeof o.interval === 'number') {
        if (this._timer) {
          clearTimeout(this._timer);
        }
        debug(this._id + ': new interval (1) ' + o.interval);
        this._timer = setTimeout(this._onTimeout.bind(this), o.interval);
      }
    } catch (e) {
      debug('Malformed message:', msg);
      this.emit('error', e);
    }
  }

  join() {
    return new Promise(async (resolve, reject) => {
      if (!this._sub) {
        return reject(new Error('Can not join without redis client (sub)'));
      }
      await this._sub.subscribe(this._id, this._onSubMessage.bind(this));
      resolve()
    })
      .then(() => {
        return this._redisTime();
      })
      .then((now) => {
        return this._pub.multi()
          .LREM(this._keys.ch, 0, this._id)
          .LPUSH(this._keys.ch, this._id)
          .EVALSHA(
            scripts.update.sha,
            {
              keys: [this._keys.gl, this._keys.ch, this._keys.ei, this._keys.ed, this._keys.et],
              arguments: ['', now.toString(), '0', this._option.confTimeout.toString()]
            }
          )
          .EXEC()
          .then((replies) => {
            throwIfMultiError(replies);
            /* istanbul ignore if  */
            if (this._timer) {
              clearTimeout(this._timer);
            }
            debug(this._id + ': new interval (2) ' + replies[2][1]);
            this._timer = setTimeout(this._onTimeout.bind(this), replies[2][1]);
          });
      }).catch(e => this.emit('error', e));
  }

  leave() {
    // return new Promise(async (resolve, reject) => {
    //   if (!this._sub) {
    //     return reject(new Error('Can not join without redis client (sub)'));
    //   }
    //   await this._sub.subscribe(this._id, this._onSubMessage.bind(this));
    //   resolve()
    // })
    //   .then(() => {
    //     return this._redisTime();
    //   })
    //   .then((now) => {
    //     return this._pub.multi()
    //       .LREM(this._keys.ch, 0, this._id)
    //       .LPUSH(this._keys.ch, this._id)
    //       .EVALSHA(
    //         scripts.update.sha,
    //         {
    //           keys: [this._keys.gl, this._keys.ch, this._keys.ei, this._keys.ed, this._keys.et],
    //           arguments: ['', now.toString(), '0', this._option.confTimeout.toString()]
    //         }
    //       )
    //       .EXEC()
    //       .then((replies) => {
    //         throwIfMultiError(replies);
    //         /* istanbul ignore if  */
    //         if (this._timer) {
    //           clearTimeout(this._timer);
    //         }
    //         debug(this._id + ': new interval (2) ' + replies[2][1]);
    //         this._timer = setTimeout(this._onTimeout.bind(this), replies[2][1]);
    //       });
    //   });
  }

  post(ev, delay) {
    let evId;

    if (typeof delay !== 'number') {
      throw new Error('delay argument must be of type number');
    }

    // Copy event.
    ev = JSON.parse(JSON.stringify(ev));

    if (typeof ev !== 'object') {
      throw new Error('event data must be of type object');
    }

    if (ev.hasOwnProperty('id')) {
      if (typeof ev.id !== 'string' || ev.id.length === 0) {
        throw new Error('event ID must be a non-empty string');
      }
    } else {
      ev.id = uuid.v4();
    }
    evId = ev.id;

    if (ev.hasOwnProperty('maxRetries')) {
      if (typeof ev.maxRetries !== 'number') {
        throw new Error('maxRetries must be a number');
      }
    } else {
      ev.maxRetries = 0;
    }

    let msg = JSON.stringify(ev);

    return this._redisTime()
      .then((now) => {
        return this._pub.multi()
          .ZADD(this._keys.ei, { score: now + delay, value: evId })
          .HSET(this._keys.ed, evId, msg)
          .EVALSHA(
            scripts.update.sha,
            {
              keys: [this._keys.gl, this._keys.ch, this._keys.ei, this._keys.ed, this._keys.et],
              arguments: ['', now.toString(), '0', this._option.confTimeout.toString()]
            }
          )
          .EXEC()
          .then((results) => {
            throwIfMultiError(results);
            return evId;
          })
          .catch(e => this.emit('error', e));
      });
  }

  peek(evId) {
    return this._redisTime()
      .then((now) => {
        return this._pub.multi()
          .ZSCORE(this._keys.ei, evId)
          .HGET(this._keys.ed, evId)
          .EXEC()
          .then((results) => {
            throwIfMultiError(results);
            let res = [null, null]
            if (results[0] === null || results[1] === null) {

              return [null, null];
            }
            return [
              Math.max(parseInt(results[0]) - now, 0),
              JSON.parse(results[1])
            ];
          })
          .catch(e => this.emit('error', e));
      });
  }

  cancel(evId) {
    return this._redisTime()
      .then((now) => {
        return this._pub.multi()
          .EVALSHA(
            scripts.cancel.sha,
            {
              keys: [this._keys.ei, this._keys.ed],
              arguments: [evId]
            }
          )
          .EVALSHA(
            scripts.update.sha,
            {
              keys: [this._keys.gl, this._keys.ch, this._keys.ei, this._keys.ed, this._keys.et],
              arguments: ['', now.toString(), '0', this._option.confTimeout.toString()]
            }
          )
          .EXEC()
          .then((results) => {
            throwIfMultiError(results);
            return results[0];
          })
          .catch(e => this.emit('error', e));
      });
  }

  confirm(evId) {
    return this._redisTime()
      .then((now) => {
        return this._pub.multi()
          .EVALSHA(
            scripts.cancel.sha,
            {
              keys: [this._keys.et, this._keys.ed],
              arguments: [evId]
            }
          )
          .EVALSHA(
            scripts.update.sha,
            {
              keys: [this._keys.gl, this._keys.ch, this._keys.ei, this._keys.ed, this._keys.et],
              arguments: ['', now.toString(), '0', this._option.confTimeout.toString()]
            }
          )
          .EXEC()
          .then((results) => {
            throwIfMultiError(results);
            return results[0];
          })
          .catch(e => this.emit('error', e));
      });
  }

  changeDelay(evId, delay, cb) {
    if (typeof delay !== 'number') {
      throw new Error('delay argument must be of type number');
    }

    return this._redisTime()
      .then((now) => {
        return this._pub.multi()
          .EVALSHA(
            scripts.changeDelay.sha,
            {
              keys: [this._keys.ei],
              arguments: [evId, (now + delay).toString()]
            },
          )
          .EVALSHA(
            scripts.update.sha,
            {
              keys: [this._keys.gl, this._keys.ch, this._keys.ei, this._keys.ed, this._keys.et],
              arguments: ['', now.toString(), '0', this._option.confTimeout.toString()]
            }
          )
          .EXEC()
          .then((results) => {
            throwIfMultiError(results);
            return results[0];
          })
          .catch(e => this.emit('error', e));
      });
  }

  _onTimeout() {
    this._timer = null;
    this._redisTime()
      .then((now) => {
        let interval;
        return this._pub.EVALSHA(
          scripts.update.sha,
          {
            keys: [this._keys.gl, this._keys.ch, this._keys.ei, this._keys.ed, this._keys.et],
            arguments: [this._id, now.toString(), this._maxEvents.toString(), this._option.confTimeout.toString()]
          })
          .then((replies) => {
            interval = replies[1];
            if (replies[0].length > 0) {
              replies[0].forEach((sev) => {
                let ev;
                try {
                  ev = JSON.parse(sev);
                } catch (e) {
                  debug(this._id + ': fail to parse event. ' + JSON.stringify(e));
                  return;
                }
                this.emit('event', ev);
              });
            }
          }, (err) => {
            interval = 3000;
            debug(this._id + ': update failed: ' + err.name);
          })
          .finally(() => {
            if (!this._timer) {
              debug(this._id + ': new interval (3) ' + interval);
              this._timer = setTimeout(this._onTimeout.bind(this), interval);
            }
          });
      }, (err) => {
        this.emit('error', err);
      });
  }

  upcoming(option, cb) {
    let defaults = {
      offset: -1,
      duration: -1, // +inf
      limit: -1     // +inf
    };
    let _option;

    if (typeof option !== 'object') {
      cb = option;
      _option = defaults;
    } else {
      _option = _und.defaults(option, defaults);
    }

    return this._redisTime()
      .then((now) => {
        let args = [this._keys.ei];
        let offset = 0;
        if (typeof _option.offset !== 'number' || _option.offset < 0) {
          args.push(0);
        } else {
          args.push(now + _option.offset);
          offset = _option.offset;
        }
        if (typeof _option.duration !== 'number' || _option.duration < 0) {
          args.push('+inf');
        } else {
          args.push(now + offset + _option.duration);
        }
        args.push('WITHSCORES');
        if (typeof _option.limit === 'number' && _option.limit > 0) {
          args.push('LIMIT');
          args.push(0);
          args.push(_option.limit);
        }
        debug('upcoming args: ' + JSON.stringify(args));

        return this._pub.ZRANGEBYSCORE(args)
          .then((results) => {
            if (results.length === 0) {
              return {};
            }

            let out = [];
            args = [this._keys.ed];
            for (let i = 0; i < results.length; i += 2) {
              out.push({ expireAt: parseInt(results[i + 1]), id: results[i] });
              args.push(results[i]);
            }

            return this._pub.HMGET(args)
              .then((results) => {
                let outObj = {};
                let event = ""
                results.forEach((evStr, index) => {
                  /* istanbul ignore if  */
                  if (!evStr) {
                    return;
                  }
                  /* istanbul ignore next  */
                  try {
                    event = JSON.parse(evStr);
                  } catch (e) {
                    debug(this._id + ': fail to parse event. ' + JSON.stringify(e));
                    return;
                  }
                  outObj[out[index].id] = { expireAt: out[index].expireAt, event: event };
                });
                return outObj;
              })
              .catch(e => this.emit('error', e));
          });
      });
  }
}

module.exports.DTimer = ClassDTimer;