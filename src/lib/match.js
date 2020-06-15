/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS202: Simplify dynamic range loops
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const async = require("async");
const extend = require('util')._extend;
const api = require("../api.js");
const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");
const {
	ObjectID
} = require('mongodb');

const Promise = require('bluebird');

class MatchAPI extends AbstractAPI {
	constructor() {
		super();
	}

	configure(xtralifeApi, callback) {
		this.xtralifeApi = xtralifeApi;
		logger.info("Matches initialized");
		return async.parallel([
			cb => {
				return this.coll('matches').createIndex({ domain: 1 }, { unique: false }, cb);
			},
			cb => {
				return this.coll('matches').createIndex({ status: 1 }, { unique: false }, cb);
			},
			cb => {
				return this.coll('matches').createIndex({ players: 1 }, { unique: false }, cb);
			},
			cb => {
				return this.coll('matches').createIndex({ invitees: 1 }, { unique: false }, cb);
			},
			cb => {
				return this.coll('matches').createIndex({ full: 1 }, { unique: false }, cb);
			}
		], err => callback(err));
	}

	// remove common data (only in sandbox, no need to be too picky) - called from api.onDeleteUser
	onDeleteUser(userid, callback) {
		logger.debug(`delete user ${userid} for matches`);
		const matchColl = this.coll('matches');
		// Leave all matches to which the user belongs
		return matchColl.find({ players: userid }).toArray((err, matches) => {
			let match;
			if (err != null) { return callback(err); }

			// We'll execute all these in parallel
			const tasks = [];
			for (match of Array.from(matches)) {
				(match => {
					return tasks.push(cb => {
						return this._leaveMatchSilently(match._id, userid)
							.then(() => cb());
					});
				})(match);
			}

			// Plus delete all matches created by that person as well
			return matchColl.find({ creator: userid }).toArray((err, matches) => {
				if (err != null) { return callback(err); }

				for (match of Array.from(matches)) {
					(match => {
						return tasks.push(cb => this._forceDeleteMatch(match._id, cb));
					})(match);
				}

				return async.series(tasks, (err, results) => callback(err));
			});
		});
	}


	// remove game specific data data
	onDeleteUserForGame(appId, userid, callback) {
		return callback(null);
	}

	createMatch(context, domain, user_id, description, maxPlayers, customProperties, globalState, shoe) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));

		return Promise.try(() => {
			if (maxPlayers == null) { throw new errors.BadArgument; }

			// We can now create a match using the data
			const toInsert = {
				domain,
				creator: user_id,
				status: 'running',
				description,
				customProperties: customProperties || {},
				maxPlayers,
				players: [user_id],
				full: maxPlayers === 1,
				seed: Math.floor(Math.random() * 2147483647),
				shoe: this._shuffleArray(shoe),
				shoeIndex: 0,
				globalState: globalState || {},
				lastEventId: new ObjectID(),
				events: [],
				gamerData: [{ gamer_id: user_id }]
			};
			toInsert._id = new ObjectID();

			return this.handleHook("before-match-create", context, domain, {
				domain,
				user_id,
				match: toInsert
			}).then(() => {
				return this.coll('matches').insertOne(toInsert)
					.then(result => {
						if (result.result.n !== 1) { throw new errors.BadArgument; }
						// Success
						return this._enrichMatchForReturningAsync(toInsert)
							.tap(match => {
								return this.handleHook("after-match-create", context, domain, {
									domain,
									user_id,
									match
								}
								);
							});
					});
			});
		});
	}

	// Only the owner (creator) can delete a match, and it must be finished!
	deleteMatch(context, match_id, creator_gamer_id) {
		const matchColl = this.coll('matches');
		const query = { _id: match_id, creator: creator_gamer_id };

		return matchColl.findOne(query)
			.then(match => {
				if (match == null) { throw new errors.BadMatchID; }
				if (match.status !== 'finished') { throw new errors.MatchNotFinished; }

				return this.handleHook("before-match-delete", context, match.domain, {
					user_id: creator_gamer_id,
					match
				}).then(() => {
					query['status'] = 'finished';
					return matchColl.deleteOne(query);
				}).tap(result => {
					return this.handleHook("after-match-delete", context, match.domain, {
						user_id: creator_gamer_id,
						match
					}
					);
				}).then(result => result.result.n);
			});
	}

	dismissInvitation(context, match_id, gamer_id) {
		return this.coll('matches').findOneAndUpdate({ _id: match_id, invitees: gamer_id },
			{ $pull: { invitees: gamer_id } }, { upsert: false, returnOriginal: false })
			.then(result => {
				const match = result.value;
				if (match == null) { throw new errors.BadMatchID; }
				return this.handleHook("after-match-dismissinvitation", context, match.domain, {
					user_id: gamer_id,
					match
				}).then(() => match);
			});
	}

	// .spread (match, drawnItems)
	// eventOsn is used throughout the whole class to send an OS notification
	drawFromShoe(context, match_id, gamer_id, eventOsn, lastEventId, count) {
		return this.coll('matches').findOne({ _id: match_id, status: { $ne: 'finished' }, players: gamer_id })
			.then(match => {
				if (match == null) { throw new errors.BadMatchID; }
				if (!((match.shoe != null ? match.shoe.length : undefined) > 0)) { throw new errors.NoShoeInMatch; }
				if (!lastEventId.equals(match.lastEventId)) { throw new errors.InvalidLastEventId; }

				const drawnItems = [];
				let additionalShoeItems = [];
				for (let drawn = 0, end = count - 1, asc = 0 <= end; asc ? drawn <= end : drawn >= end; asc ? drawn++ : drawn--) {
					// Peek next -> end of list requires re-shuffling and start up anew
					if (match.shoeIndex >= match.shoe.length) {
						// Append shuffled items to both arrays
						const toAdd = this._shuffleArray(match.shoe.slice(0));
						match.shoe = match.shoe.concat(toAdd);
						additionalShoeItems = additionalShoeItems.concat(toAdd);
					}
					drawnItems.push(match.shoe[match.shoeIndex++]);
				}

				// Check for concurrency with the last event ID
				const query = {
					_id: match_id,
					status: { $ne: 'finished' },
					players: gamer_id,
					lastEventId: match.lastEventId
				};
				const event = {
					type: 'match.shoedraw',
					event: {
						_id: new ObjectID(),
						count
					}
				};
				const update = {
					'$set': {
						shoeIndex: match.shoeIndex,
						lastEventId: event.event._id
					},
					'$push': {
						events: event
					}
				};

				if ((xlenv.options.useMongodbPushall != null) && xlenv.options.useMongodbPushall) {
					if (additionalShoeItems.length > 0) { update.$pushAll = { shoe: additionalShoeItems }; }
				} else {
					if (additionalShoeItems.length > 0) { update['$push'].shoe = { '$each': additionalShoeItems }; }
				}

				return this.handleHook("before-match-drawfromshoe", context, match.domain, {
					user_id: gamer_id,
					match,
					drawnItems
				}).then(() => {
					return this.coll('matches').findOneAndUpdate(query, update, { upsert: false, returnOriginal: false })
						.then(result => {
							const updatedMatch = result.value;
							this._broadcastEvent(gamer_id, updatedMatch, event, eventOsn);
							return this.handleHook("after-match-drawfromshoe", context, match.domain, {
								user_id: gamer_id,
								match: updatedMatch,
								drawnItems
							}).then(() => [updatedMatch, drawnItems]);
						});
				});
			});
	}

	getMatch(match_id) {
		return this.coll('matches').findOne({ _id: match_id })
			.then(match => {
				if (match == null) { throw new errors.BadMatchID; }
				return this._enrichMatchForReturningAsync(match);
			});
	}

	// .spread (count, matches)
	findMatches(domain, user_id, customProperties, skip, limit, includeFinished, includeFull, onlyParticipating, onlyInvited) {
		this.pre(check => ({
			"domain must be a valid domain": check.nonEmptyString(domain),
			"user_id must be an ObjectID": check.objectid(user_id)
		}));

		const query = { domain };
		if (!includeFinished) { query.status = { $ne: 'finished' }; }
		if (!includeFull) { query.full = false; }
		if (onlyParticipating) { query.players = user_id; }
		if (onlyInvited) { query.invitees = user_id; }
		for (let attr in customProperties) { const value = customProperties[attr]; query[`customProperties.${attr}`] = value; }
		const cursor = this.coll('matches').find(query, {
			skip,
			limit
		}
		);
		return cursor.count().then(count => {
			return cursor.toArray()
				.then(matches => {
					// Complete the matches with the detailed profile of the owner
					return this._enrichMatchListForReturningAsync(matches)
						.then(matches => {
							return [count, matches];
						});
				});
		});
	}

	finishMatch(context, match_id, caller_gamer_id, eventOsn, lastEventId) {
		// Check for invalid parameters first
		return this.coll('matches').findOne({ _id: match_id, players: caller_gamer_id })
			.then(match => {
				if (match == null) { throw new errors.BadMatchID; }
				if (match.status === 'finished') { throw new errors.MatchAlreadyFinished; }
				if (!lastEventId.equals(match.lastEventId)) { throw new errors.InvalidLastEventId; }

				const event = {
					type: 'match.finish',
					event: {
						_id: new ObjectID(),
						finished: 1
					}
				};
				const query = {
					_id: match_id,
					status: { $ne: 'finished' },
					players: caller_gamer_id
				};
				const replacement = {
					$set: {
						status: 'finished',
						lastEventId: event.event._id
					},
					$push: {
						events: event
					}
				};

				return this.handleHook("before-match-finish", context, match.domain, {
					user_id: caller_gamer_id,
					match
				}).then(() => {
					return this.coll('matches').findOneAndUpdate(query, replacement, { upsert: false, returnOriginal: false })
						.then(result => {
							match = result.value;
							if (match == null) { throw new errors.BadArgument; }

							// Now notify all players except the current one
							this._broadcastEvent(caller_gamer_id, match, event, eventOsn);
							return this.handleHook("after-match-finish", context, match.domain, {
								user_id: caller_gamer_id,
								match
							}).then(() => match);
						});
				});
			});
	}

	inviteToMatch(context, match_id, caller_gamer_id, invitee_id, eventOsn) {
		// Conditions: Caller must be owner of the match,
		// invitee must not be part of the match or already invited
		return this.coll('matches').findOne({ _id: match_id, creator: caller_gamer_id })
			.then(match => {
				let p;
				if (match == null) { throw new errors.BadMatchID; }
				const alreadyInvited = ((() => {
					const result = [];
					for (p of Array.from(match.players)) {
						if (p.equals(invitee_id)) {
							result.push(0);
						}
					}
					return result;
				})()).length;
				if (alreadyInvited > 0) { throw new errors.AlreadyJoinedMatch; }
				const alreadyPart = ((() => {
					const result1 = [];
					for (p of Array.from(match.invitees || [])) {
						if (p.equals(invitee_id)) {
							result1.push(0);
						}
					}
					return result1;
				})()).length;
				if (alreadyPart > 0) { throw new errors.AlreadyInvitedToMatch; }

				// Check that the invitee exists
				return this.coll('users').findOne({ _id: invitee_id })
					.then(user => {
						if (user == null) { throw new errors.BadGamerID; }

						// Populate with user info
						return this.xtralifeApi.social.describeUsersListBase([caller_gamer_id])
							.then(users => {
								if (users.length !== 1) { throw new errors.InternalError("Gamer has been deleted"); }

								// Make an invitation event
								const event = {
									type: 'match.invite',
									event: {
										match_id,
										inviter: users[0]
									}
								};
								const query = {
									_id: match_id,
									players: { $ne: invitee_id },
									invitees: { $ne: invitee_id }
								};
								const update =
									{ $push: { invitees: invitee_id } };

								return this.handleHook("before-match-invite", context, match.domain, {
									user_id: caller_gamer_id,
									match,
									invitee_id
								}).then(() => {
									return this.coll('matches').findOneAndUpdate(query, update, { upsert: false, returnOriginal: false })
										.then(result => {
											match = result.value;
											if (match == null) { throw new errors.BadArgument; }

											// Notify the player
											if (this.xtralifeApi.game.hasListener(match.domain)) { xlenv.broker.send(match.domain, invitee_id.toString(), event).done(); }
											return this.handleHook("after-match-invite", context, match.domain, {
												user_id: caller_gamer_id,
												match,
												invitee_id
											}).then(() => match);
										});
								});
							});
					});
			});
	}


	joinMatch(context, match_id, gamer_id, eventOsn) {
		// Check that the player doesn't already belong to the game and that the maximum number of players wouldn't be exceeded
		const matchColl = this.coll('matches');
		return matchColl.findOne({ _id: match_id, status: { $ne: 'finished' } })
			.then(match => {
				if (match == null) { throw new errors.BadMatchID; }
				if (((() => {
					const result = [];
					for (let p of Array.from(match.players)) {
						if (gamer_id.equals(p)) {
							result.push(p);
						}
					}
					return result;
				})()).length > 0) { throw new errors.AlreadyJoinedMatch; }
				if (match.players.length >= match.maxPlayers) { throw new errors.MaximumNumberOfPlayersReached; }

				// Populate with user info
				return this.xtralifeApi.social.describeUsersListBase([gamer_id])
					.then(users => {
						if (users.length !== 1) { throw new errors.InternalError("Gamer has been deleted"); }

						// Now we can try to make him join the match
						const event = {
							type: 'match.join',
							event: {
								_id: new ObjectID(),
								playersJoined: users
							}
						};
						// LastEventId check for concurrency
						const query = {
							_id: match_id,
							status: { $ne: 'finished' },
							players: { $nin: [gamer_id] },
							full: false,
							lastEventId: match.lastEventId
						};
						const update = {
							$push: {
								players: gamer_id,
								gamerData: { gamer_id },
								events: event
							},
							$pull: {
								invitees: gamer_id
							},
							$set: {
								lastEventId: event.event._id,
								full: (match.players.length + 1) >= match.maxPlayers
							}
						};

						return this.handleHook("before-match-join", context, match.domain, {
							user_id: gamer_id,
							match
						}).then(() => {
							return matchColl.findOneAndUpdate(query, update, { upsert: false, returnOriginal: false });
						})
							.then(result => {
								const modified = result.value;
								if (modified == null) { throw new errors.ConcurrentModification; }

								// Notify other players
								this._broadcastEvent(gamer_id, match, event, eventOsn);
								return this.handleHook("after-match-join", context, match.domain, {
									user_id: gamer_id,
									match: modified
								}).then(() => this._enrichMatchForReturningAsync(modified));
							});
					});
			});
	}

	// Removes an user from the match
	leaveMatch(context, match_id, gamer_id, eventOsn) {
		// Populate with user info
		return this.xtralifeApi.social.describeUsersListBase([gamer_id])
			.then(users => {
				if (users.length !== 1) { throw new errors.InternalError("Gamer has been deleted"); }

				const event = {
					type: 'match.leave',
					event: {
						_id: new ObjectID(),
						playersLeft: users
					}
				};

				return this._leaveMatchSilently(match_id, gamer_id, event)
					.then(match => {
						// Notify other players
						this._broadcastEvent(gamer_id, match, event, eventOsn);
						return this.handleHook("after-match-leave", context, match.domain, {
							user_id: gamer_id,
							match
						}).then(() => match);
					});
			});
	}

	postMove(context, match_id, gamer_id, eventOsn, lastEventId, moveData) {
		// Check for invalid parameters first
		return this.coll('matches').findOne({ _id: match_id, status: { $ne: 'finished' }, players: gamer_id })
			.then(match => {
				let update, value;
				if (match == null) { throw new errors.BadMatchID; }
				if (!lastEventId.equals(match.lastEventId)) { throw new errors.InvalidLastEventId; }

				const move = {
					type: 'match.move',
					event: {
						_id: new ObjectID(),
						player_id: gamer_id,
						move: moveData.move
					}
				};

				const query = {
					_id: match_id,
					status: { $ne: 'finished' },
					players: gamer_id,
					lastEventId
				};

				const {
					globalState
				} = moveData;
				if (globalState != null) {
					// Clear stored moves as we have a new global state to start from
					const fieldSet = {};
					for (let key in globalState) { value = globalState[key]; fieldSet[`globalState.${key}`] = value; }
					fieldSet['lastEventId'] = move.event._id;
					fieldSet['events'] = [move];
					update = { $set: fieldSet };
				} else {
					// No global state, only an additional move
					update = { $push: { events: move }, $set: { lastEventId: move.event._id } };
				}

				return this.handleHook("before-match-postmove", context, match.domain, {
					user_id: gamer_id,
					match,
					move: moveData
				}).then(() => {
					return this.coll('matches').findOneAndUpdate(query, update, { upsert: false, returnOriginal: false });
				})
					.then(result => {
						const modified = result.value;
						if (modified == null) { throw new errors.BadMatchID; }

						// Now notify all players except the current one
						this._broadcastEvent(gamer_id, modified, move, eventOsn);

						return this.handleHook("after-match-postmove", context, match.domain, {
							user_id: gamer_id,
							match,
							move: moveData
						}).then(() => modified);
					});
			});
	}

	_broadcastEvent(originating_player_id, match, message, eventOsn) {
		message.event.match_id = match._id;
		if (eventOsn != null) { message.event.osn = eventOsn; }
		return (() => {
			const result = [];
			for (let player of Array.from(match.players)) {
				if (!player.equals(originating_player_id) && this.xtralifeApi.game.hasListener(match.domain)) {
					result.push(xlenv.broker.send(match.domain, player.toString(), message).done());
				} else {
					result.push(undefined);
				}
			}
			return result;
		})();
	}

	_enrichMatchForReturningAsync(match) {
		// Do not modify the original object
		const userList = match.players.concat(match.creator);
		//console.log "Querying for USERS " + JSON.stringify(userList)
		return this.xtralifeApi.social.describeUsersListBase(userList)
			.then(users => {
				match.players = (Array.from(match.players).map((p) => this._userFromUserList(p, users)));
				match.creator = this._userFromUserList(match.creator, users);
				return match;
			});
	}

	_enrichMatchListForReturningAsync(matches) {
		const userList = (Array.from(matches).map((m) => m.creator));
		return this.xtralifeApi.social.describeUsersListBase(userList)
			.then(users => {
				for (let match of Array.from(matches)) {
					match.creator = this._userFromUserList(match.creator, users);
				}
				return matches;
			});
	}

	_forceDeleteMatch(match_id, callback) {
		return this.coll('matches').deleteOne({ _id: match_id }, function (err, writeResult) {
			if (err != null) { return callback(err); }
			if (writeResult.result.n === 0) { return callback(new errors.BadMatchID); }
			return callback(null);
		});
	}

	_leaveMatchSilently(match_id, gamer_id, optional_event) {
		// Find the match and check that the user belongs to it
		const query = {
			_id: match_id,
			players: gamer_id
		};
		const update = {
			$set: {
				full: false
			},
			$pull: {
				players: gamer_id,
				gamerData: { gamer_id }
			}
		};
		if (optional_event != null) {
			update['$push'] = { events: optional_event };
			update['$set'] = { lastEventId: optional_event.event._id };
		}

		return this.coll('matches').findOneAndUpdate(query, update, { upsert: false, returnOriginal: false })
			.then(result => {
				const modified = result.value;
				if (modified == null) { throw new errors.BadMatchID; }
				return modified;
			});
	}

	// Jonas Raoni Soares Silva
	// http://jsfromhell.com/array/shuffle [v1.0]
	_shuffleArray(o) {
		if (o == null) { return o; }
		for (let start = o.length - 1, i = start, asc = start <= 0; asc ? i <= 0 : i >= 0; asc ? i++ : i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const x = o[i];
			o[i] = o[j];
			o[j] = x;
		}
		return o;
	}

	_userFromUserList(user_id, users) {
		return ((() => {
			const result = [];
			for (let k in users) {
				const v = users[k];
				if (v.gamer_id.equals(user_id)) {
					result.push(v);
				}
			}
			return result;
		})())[0];
	}

	// BACKOFFICE ###########################################################################

	list(domain, skip, limit, hideFinished, withGamer_id, customProperties) {
		const filter = { domain };
		if (hideFinished === true) { filter.status = { $ne: 'finished' }; }
		if ((withGamer_id != null) && (withGamer_id.length === 24)) { filter.players = ObjectID(withGamer_id); }
		// https://github.com/clutchski/coffeelint/issues/189
		try {
			if (customProperties != null) { filter.customProperties = JSON.parse(customProperties); }
		} catch (err) {
			undefined;
		}

		const cursor = this.coll('matches').find(filter, {
			skip,
			limit
		}
			//				fields :
			//					password : 0
			//					networksecret : 0
		);
		return cursor.count()
			.then(count => {
				return cursor.toArray()
					.then(docs => {
						return [count, docs];
					});
			});
	}

	updateMatch(matchId, updatedMatch) {
		return this.coll('matches').findOneAndUpdate({ _id: matchId }, { $set: updatedMatch }, { upsert: false, returnOriginal: false })
			.then(result => result != null ? result.value : undefined);
	}

	sandbox(context) {
		return {
			createMatch: (domain, user_id, description, maxPlayers, customProperties, globalState, shoe) => {
				if (this.xtralifeApi.game.checkDomainSync(context.game.appid, domain)) {
					return this.createMatch(context, domain, user_id, description, maxPlayers, customProperties, globalState, shoe);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			deleteMatch: (match_id, creator_gamer_id) => {
				return this.deleteMatch(context, match_id, creator_gamer_id);
			},

			dismissInvitation: (match_id, gamer_id) => {
				return this.dismissInvitation(context, match_id, gamer_id);
			},

			drawFromShoe: (match_id, gamer_id, eventOsn, lastEventId, count) => {
				return this.drawFromShoe(context, match_id, gamer_id, eventOsn, lastEventId, count);
			},

			getMatch: match_id => {
				return this.getMatch(match_id);
			},

			// deprecated since 2.11
			findMatches: (domain, user_id, customProperties, skip, limit, includeFinished, includeFull, onlyParticipating, onlyInvited) => {
				return this.findMatches(domain, user_id, customProperties, skip, limit, includeFinished, includeFull, onlyParticipating, onlyInvited);
			},

			finishMatch: (match_id, caller_gamer_id, eventOsn, lastEventId) => {
				return this.finishMatch(context, match_id, caller_gamer_id, eventOsn, lastEventId);
			},

			inviteToMatch: (match_id, caller_gamer_id, invitee_id) => {
				return this.inviteToMatch(context, match_id, caller_gamer_id, invitee_id);
			},

			joinMatch: (match_id, gamer_id, eventOsn) => {
				return this.joinMatch(context, match_id, gamer_id, eventOsn);
			},

			leaveMatch: (match_id, gamer_id, eventOsn) => {
				return this.leaveMatch(context, match_id, gamer_id, eventOsn);
			},

			postMove: (match_id, gamer_id, moveData, lastEventId, eventOsn) => {
				return this.postMove(context, match_id, gamer_id, eventOsn, lastEventId, moveData);
			}
		};
	}
}

module.exports = new MatchAPI();
