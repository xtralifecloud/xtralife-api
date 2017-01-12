async = require "async"
extend = require('util')._extend
api = require "../api.coffee"
AbstractAPI = require "../AbstractAPI.coffee"
errors = require "../errors.coffee"
ObjectID = require('mongodb').ObjectID

Q = require 'bluebird'

class MatchAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@xtralifeApi, callback)->
		logger.info "Matches initialized"
		async.parallel [
			(cb)=>
				@coll('matches').ensureIndex {domain: 1}, {unique: false}, cb
			(cb)=>
				@coll('matches').ensureIndex {status: 1}, {unique: false}, cb
			(cb)=>
				@coll('matches').ensureIndex {players: 1}, {unique: false}, cb
			(cb)=>
				@coll('matches').ensureIndex {invitees: 1}, {unique: false}, cb
			(cb)=>
				@coll('matches').ensureIndex {full: 1}, {unique: false}, cb
		], (err)->
			callback err

	# remove common data (only in sandbox, no need to be too picky) - called from api.onDeleteUser
	onDeleteUser: (userid, callback)->
		logger.debug "delete user #{userid} for matches"
		matchColl = @coll('matches')
		# Leave all matches to which the user belongs
		matchColl.find({players: userid}).toArray (err, matches)=>
			return callback err if err?

			# We'll execute all these in parallel
			tasks = []
			for match in matches
				do (match)=>
					tasks.push (cb)=>
						@_leaveMatchSilently match._id, userid
						.then ()-> cb()

			# Plus delete all matches created by that person as well
			matchColl.find({creator: userid}).toArray (err, matches)=>
				return callback err if err?

				for match in matches
					do (match)=>
						tasks.push (cb)=> @_forceDeleteMatch match._id, cb

				async.series tasks, (err, results)=> callback err


	# remove game specific data data
	onDeleteUserForGame: (appId, userid, callback)->
		callback null

	createMatch: (context, domain, user_id, description, maxPlayers, customProperties, globalState, shoe)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)

		Q.try =>
			throw new errors.BadArgument unless maxPlayers?

			# We can now create a match using the data
			toInsert =
				domain: domain
				creator: user_id
				status: 'running'
				description: description
				customProperties: customProperties or {}
				maxPlayers: maxPlayers
				players: [user_id]
				full: maxPlayers is 1
				seed: Math.floor(Math.random() * 2147483647)
				shoe: @_shuffleArray(shoe)
				shoeIndex: 0
				globalState: globalState or {}
				lastEventId: new ObjectID()
				events: []
				gamerData: [{gamer_id: user_id}]
			toInsert._id = new ObjectID()

			@handleHook "before-match-create", context, domain,
				domain: domain
				user_id: user_id
				match: toInsert
			.then =>
				@coll('matches').insert toInsert
				.then (result)=>
					throw new errors.BadArgument if result.result.n isnt 1
					# Success
					@_enrichMatchForReturningAsync toInsert
					.tap (match)=>
						@handleHook "after-match-create", context, domain,
							domain: domain
							user_id: user_id
							match: match

	# Only the owner (creator) can delete a match, and it must be finished!
	deleteMatch: (context, match_id, creator_gamer_id)->
		matchColl = @coll('matches')
		query = {_id: match_id, creator: creator_gamer_id}

		matchColl.findOne query
		.then (match)=>
			throw new errors.BadMatchID unless match?
			throw new errors.MatchNotFinished if match.status isnt 'finished'

			@handleHook "before-match-delete", context, match.domain,
				user_id: creator_gamer_id
				match: match
			.then =>
				query['status'] = 'finished'
				matchColl.remove query
			.tap (result)=>
				@handleHook "after-match-delete", context, match.domain,
					user_id: creator_gamer_id
					match: match
			.then (result)->
				return result.result.n

	dismissInvitation: (context, match_id, gamer_id)->
		@coll('matches').findAndModify {_id: match_id, invitees: gamer_id},
		{}, {$pull: {invitees: gamer_id}}, {new: true, upsert: false}
		.then (result)=>
			match = result.value
			throw new errors.BadMatchID unless match?
			@handleHook "after-match-dismissinvitation", context, match.domain,
				user_id: gamer_id
				match: match
			.then -> return match

	# .spread (match, drawnItems)
	# eventOsn is used throughout the whole class to send an OS notification
	drawFromShoe: (context, match_id, gamer_id, eventOsn, lastEventId, count)->
		@coll('matches').findOne {_id: match_id, status: {$ne: 'finished'}, players: gamer_id}
		.then (match)=>
			throw new errors.BadMatchID unless match?
			throw new errors.NoShoeInMatch unless match.shoe?.length > 0
			throw new errors.InvalidLastEventId unless lastEventId.equals(match.lastEventId)

			drawnItems = []
			additionalShoeItems = []
			for drawn in [0 .. count - 1]
				# Peek next -> end of list requires re-shuffling and start up anew
				if match.shoeIndex >= match.shoe.length
					# Append shuffled items to both arrays
					toAdd = @_shuffleArray(match.shoe.slice(0))
					match.shoe = match.shoe.concat toAdd
					additionalShoeItems = additionalShoeItems.concat toAdd
				drawnItems.push match.shoe[match.shoeIndex++]

			# Check for concurrency with the last event ID
			query =
				_id: match_id
				status: {$ne: 'finished'}
				players: gamer_id
				lastEventId: match.lastEventId
			event =
				type: 'match.shoedraw'
				event:
					_id: new ObjectID()
					count: count
			update =
				$set:
					shoeIndex: match.shoeIndex
					lastEventId: event.event._id
				$push:
					events: event
			update.$pushAll = {shoe: additionalShoeItems} if additionalShoeItems.length > 0

			@handleHook "before-match-drawfromshoe", context, match.domain,
				user_id: gamer_id
				match: match
				drawnItems: drawnItems
			.then =>
				@coll('matches').findAndModify query, {}, update, {new: true, upsert: false}
				.then (result)=>
					updatedMatch = result.value
					@_broadcastEvent(gamer_id, updatedMatch, event, eventOsn)
					@handleHook "after-match-drawfromshoe", context, match.domain,
						user_id: gamer_id
						match: updatedMatch
						drawnItems: drawnItems
					.then -> return [updatedMatch, drawnItems]

	getMatch: (match_id)->
		@coll('matches').findOne {_id: match_id}
		.then (match)=>
			throw new errors.BadMatchID unless match?
			@_enrichMatchForReturningAsync match

	# .spread (count, matches)
	findMatches: (domain, user_id, customProperties, skip, limit, includeFinished, includeFull, onlyParticipating, onlyInvited)->
		@pre (check)->
			"domain must be a valid domain": check.nonEmptyString(domain)
			"user_id must be an ObjectID": check.objectid(user_id)

		query = {domain: domain}
		query.status = {$ne: 'finished'} unless includeFinished
		query.full = false unless includeFull
		query.players = user_id if onlyParticipating
		query.invitees = user_id if onlyInvited
		query["customProperties.#{attr}"] = value for attr, value of customProperties
		cursor = @coll('matches').find query,
			skip: skip,
			limit: limit
		cursor.count().then (count)=>
			cursor.toArray()
			.then (matches)=>
				# Complete the matches with the detailed profile of the owner
				@_enrichMatchListForReturningAsync matches
				.then (matches)=>
					return [count, matches]

	finishMatch: (context, match_id, caller_gamer_id, eventOsn, lastEventId)->
		# Check for invalid parameters first
		@coll('matches').findOne {_id: match_id, players: caller_gamer_id}
		.then (match)=>
			throw new errors.BadMatchID unless match?
			throw new errors.MatchAlreadyFinished if match.status is 'finished'
			throw new errors.InvalidLastEventId unless lastEventId.equals(match.lastEventId)

			event =
				type: 'match.finish'
				event:
					_id: new ObjectID()
					finished: 1
			query =
				_id: match_id
				status: {$ne: 'finished'}
				players: caller_gamer_id
			replacement =
				$set:
					status: 'finished'
					lastEventId: event.event._id
				$push:
					events: event

			@handleHook "before-match-finish", context, match.domain,
				user_id: caller_gamer_id
				match: match
			.then =>
				@coll('matches').findAndModify query, {}, replacement, {new: true, upsert: false}
				.then (result)=>
					match = result.value
					throw new errors.BadArgument unless match?

					# Now notify all players except the current one
					@_broadcastEvent(caller_gamer_id, match, event, eventOsn)
					@handleHook "after-match-finish", context, match.domain,
						user_id: caller_gamer_id
						match: match
					.then -> return match

	inviteToMatch: (context, match_id, caller_gamer_id, invitee_id, eventOsn)->
		# Conditions: Caller must be owner of the match,
		# invitee must not be part of the match or already invited
		@coll('matches').findOne {_id: match_id, creator: caller_gamer_id}
		.then (match)=>
			throw new errors.BadMatchID unless match?
			alreadyInvited = (0 for p in match.players when p.equals(invitee_id)).length
			throw new errors.AlreadyJoinedMatch if alreadyInvited > 0
			alreadyPart = (0 for p in match.invitees or [] when p.equals(invitee_id)).length
			throw new errors.AlreadyInvitedToMatch if alreadyPart > 0

			# Check that the invitee exists
			@coll('users').findOne {_id: invitee_id}
			.then (user)=>
				throw new errors.BadGamerID unless user?

				# Populate with user info
				@xtralifeApi.social.describeUsersListBase [caller_gamer_id]
				.then (users)=>
					throw new errors.InternalError("Gamer has been deleted") unless users.length is 1

					# Make an invitation event
					event =
						type: 'match.invite'
						event:
							match_id: match_id
							inviter: users[0]
					query =
						_id: match_id
						players: {$ne: invitee_id}
						invitees: {$ne: invitee_id}
					update =
						$push: {invitees: invitee_id}

					@handleHook "before-match-invite", context, match.domain,
						user_id: caller_gamer_id
						match: match
						invitee_id: invitee_id
					.then =>
						@coll('matches').findAndModify query, {}, update, {new: true, upsert: false}
						.then (result)=>
							match = result.value
							throw new errors.BadArgument unless match?

							# Notify the player
							if @xtralifeApi.game.hasListener(match.domain) then xlenv.broker.send(match.domain, invitee_id.toString(), event).done()
							@handleHook "after-match-invite", context, match.domain,
								user_id: caller_gamer_id
								match: match
								invitee_id: invitee_id
							.then -> return match


	joinMatch: (context, match_id, gamer_id, eventOsn)->
		# Check that the player doesn't already belong to the game and that the maximum number of players wouldn't be exceeded
		matchColl = @coll('matches')
		matchColl.findOne {_id: match_id, status: {$ne: 'finished'}}
		.then (match)=>
			throw new errors.BadMatchID unless match?
			throw new errors.AlreadyJoinedMatch if (p for p in match.players when gamer_id.equals(p)).length > 0
			throw new errors.MaximumNumberOfPlayersReached if match.players.length >= match.maxPlayers

			# Populate with user info
			@xtralifeApi.social.describeUsersListBase [gamer_id]
			.then (users)=>
				throw new errors.InternalError("Gamer has been deleted") unless users.length is 1

				# Now we can try to make him join the match
				event =
					type: 'match.join'
					event:
						_id: new ObjectID()
						playersJoined: users
				# LastEventId check for concurrency
				query =
					_id: match_id
					status: {$ne: 'finished'}
					players: {$nin: [gamer_id]}
					full: false
					lastEventId: match.lastEventId
				update =
					$push:
						players: gamer_id
						gamerData: {gamer_id: gamer_id}
						events: event
					$pull:
						invitees: gamer_id
					$set:
						lastEventId: event.event._id
						full: (match.players.length + 1) >= match.maxPlayers

				@handleHook "before-match-join", context, match.domain,
					user_id: gamer_id
					match: match
				.then =>
					matchColl.findAndModify query, {}, update, {new: true, upsert: false}
				.then (result)=>
					modified = result.value
					throw new errors.ConcurrentModification unless modified?

					# Notify other players
					@_broadcastEvent(gamer_id, match, event, eventOsn)
					@handleHook "after-match-join", context, match.domain,
						user_id: gamer_id
						match: modified
					.then => @_enrichMatchForReturningAsync modified

	# Removes an user from the match
	leaveMatch: (context, match_id, gamer_id, eventOsn)->
		# Populate with user info
		@xtralifeApi.social.describeUsersListBase [gamer_id]
		.then (users)=>
			throw new errors.InternalError("Gamer has been deleted") unless users.length is 1

			event =
				type: 'match.leave'
				event:
					_id: new ObjectID()
					playersLeft: users

			@_leaveMatchSilently match_id, gamer_id, event
			.then (match)=>
				# Notify other players
				@_broadcastEvent(gamer_id, match, event, eventOsn)
				@handleHook "after-match-leave", context, match.domain,
					user_id: gamer_id
					match: match
				.then -> return match

	postMove: (context, match_id, gamer_id, eventOsn, lastEventId, moveData)->
		# Check for invalid parameters first
		@coll('matches').findOne {_id: match_id, status: {$ne: 'finished'}, players: gamer_id}
		.then (match)=>
			throw new errors.BadMatchID unless match?
			throw new errors.InvalidLastEventId unless lastEventId.equals(match.lastEventId)

			move =
				type: 'match.move'
				event:
					_id: new ObjectID()
					player_id: gamer_id
					move: moveData.move

			query =
				_id: match_id
				status: {$ne: 'finished'}
				players: gamer_id
				lastEventId: lastEventId

			globalState = moveData.globalState
			if globalState?
				# Clear stored moves as we have a new global state to start from
				fieldSet = {}
				fieldSet["globalState.#{key}"] = value for key, value of globalState
				fieldSet['lastEventId'] = move.event._id
				fieldSet['events'] = [move]
				update = {$set: fieldSet}
			else
				# No global state, only an additional move
				update = {$push: {events: move}, $set: {lastEventId: move.event._id}}

			@handleHook "before-match-postmove", context, match.domain,
				user_id: gamer_id
				match: match
				move: moveData
			.then =>
				@coll('matches').findAndModify query, {}, update, {new: true, upsert: false}
			.then (result)=>
				modified = result.value
				throw new errors.BadMatchID unless modified?

				# Now notify all players except the current one
				@_broadcastEvent(gamer_id, modified, move, eventOsn)

				@handleHook "after-match-postmove", context, match.domain,
					user_id: gamer_id
					match: match
					move: moveData
				.then -> return modified

	_broadcastEvent: (originating_player_id, match, message, eventOsn)->
		message.event.match_id = match._id
		message.event.osn = eventOsn if eventOsn?
		for player in match.players
			if not player.equals(originating_player_id) and @xtralifeApi.game.hasListener(match.domain)
				xlenv.broker.send(match.domain, player.toString(), message).done()

	_enrichMatchForReturningAsync: (match)->
		# Do not modify the original object
		userList = match.players.concat(match.creator)
		#console.log "Querying for USERS " + JSON.stringify(userList)
		@xtralifeApi.social.describeUsersListBase userList
		.then (users)=>
			match.players = (@_userFromUserList(p, users) for p in match.players)
			match.creator = @_userFromUserList(match.creator, users)
			return match

	_enrichMatchListForReturningAsync: (matches)->
		userList = (m.creator for m in matches)
		@xtralifeApi.social.describeUsersListBase userList
		.then (users)=>
			for match in matches
				match.creator = @_userFromUserList(match.creator, users)
			return matches

	_forceDeleteMatch: (match_id, callback)->
		@coll('matches').remove {_id: match_id}, (err, writeResult)->
			return callback err if err?
			return callback new errors.BadMatchID if writeResult.result.n is 0
			callback null

	_leaveMatchSilently: (match_id, gamer_id, optional_event)->
		# Find the match and check that the user belongs to it
		query =
			_id: match_id
			players: gamer_id
		update =
			$set:
				full: false
			$pull:
				players: gamer_id
				gamerData: {gamer_id: gamer_id}
		if optional_event?
			update['$push'] = {events: optional_event}
			update['$set'] = {lastEventId: optional_event.event._id}

		@coll('matches').findAndModify query, {}, update, {new: true, upsert: false}
		.then (result)=>
			modified = result.value
			throw new errors.BadMatchID unless modified?
			return modified

	# Jonas Raoni Soares Silva
	# http://jsfromhell.com/array/shuffle [v1.0]
	_shuffleArray: (o)->
		return o unless o?
		for i in [o.length-1 .. 0]
			j = Math.floor(Math.random() * (i + 1))
			x = o[i]
			o[i] = o[j]
			o[j] = x
		return o

	_userFromUserList: (user_id, users)->
		return (v for k, v of users when v.gamer_id.equals(user_id))[0]

# BACKOFFICE ###########################################################################

	list: (domain, skip, limit, hideFinished, withGamer_id, customProperties)->
		filter = {domain: domain}
		filter.status = {$ne: 'finished'} if hideFinished==true
		filter.players = ObjectID(withGamer_id) if withGamer_id? and withGamer_id.length == 24
		# https://github.com/clutchski/coffeelint/issues/189
		try
			filter.customProperties = JSON.parse(customProperties) if customProperties?
		catch err
			undefined

		cursor = @coll('matches').find(filter,
			skip : skip
			limit: limit
#				fields :
#					password : 0
#					networksecret : 0
		)
		cursor.count()
		.then (count)=>
			cursor.toArray()
			.then (docs)=>
				return [count, docs]

	updateMatch: (matchId, updatedMatch)->
		@coll('matches').findAndModify {_id: matchId}, {}, {$set: updatedMatch}, {new: true, upsert: false}
		.then (result)->
			return result?.value

	sandbox: (context)->
		createMatch: (domain, user_id, description, maxPlayers, customProperties, globalState, shoe)=>
			if @xtralifeApi.game.checkDomainSync context.game.appid, domain
				@createMatch context, domain, user_id, description, maxPlayers, customProperties, globalState, shoe
			else
				throw new errors.BadArgument("Your game doesn't have access to this domain")

		deleteMatch: (match_id, creator_gamer_id)=>
			@deleteMatch context, match_id, creator_gamer_id

		dismissInvitation: (match_id, gamer_id)=>
			@dismissInvitation context, match_id, gamer_id

		drawFromShoe: (match_id, gamer_id, eventOsn, lastEventId, count)=>
			@drawFromShoe context, match_id, gamer_id, eventOsn, lastEventId, count

		getMatch: (match_id)=>
			@getMatch match_id

		# deprecated since 2.11
		findMatches: (domain, user_id, customProperties, skip, limit, includeFinished, includeFull, onlyParticipating, onlyInvited)=>
			@findMatches domain, user_id, customProperties, skip, limit, includeFinished, includeFull, onlyParticipating, onlyInvited

		finishMatch: (match_id, caller_gamer_id, eventOsn, lastEventId)=>
			@finishMatch context, match_id, caller_gamer_id, eventOsn, lastEventId

		inviteToMatch: (match_id, caller_gamer_id, invitee_id)=>
			@inviteToMatch context, match_id, caller_gamer_id, invitee_id

		joinMatch: (match_id, gamer_id, eventOsn)=>
			@joinMatch context, match_id, gamer_id, eventOsn

		leaveMatch: (match_id, gamer_id, eventOsn)=>
			@leaveMatch context, match_id, gamer_id, eventOsn

		postMove: (match_id, gamer_id, moveData, lastEventId, eventOsn)=>
			@postMove context, match_id, gamer_id, eventOsn, lastEventId, moveData

module.exports = new MatchAPI()
