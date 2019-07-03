
class XLAPIError extends Error
	constructor: () ->
		super()

	isRetryable: -> false

	# we can implement @getMessage OR define @message. getMessage has precedence
	getMessage: ->
		@message

class XLAPIRetryableError extends XLAPIError
	constructor: () ->
		super()

	isRetryable: -> true

class BadArgument extends XLAPIError
	name: "BadArgument"
	message: "A passed argument is invalid"
	xtralifecode : 1

class AlreadyJoinedMatch extends XLAPIError
	name: "AlreadyJoinedMatch"
	message: "You are already being part of this match"
	xtralifecode : 1

class NoShoeInMatch extends XLAPIError
	name: "NoShoeInMatch"
	message: "Unable to draw from shoe unless items have been put in it at creation"
	xtralifecode : 1

class MatchNotFinished extends XLAPIError
	name: "MatchNotFinished"
	message: "This match needs to be finished in order to perform this operation"
	xtralifecode : 1

class MatchAlreadyFinished extends XLAPIError
	name: "MatchAlreadyFinished"
	message: "This match is already finished"
	xtralifecode : 1

class MaximumNumberOfPlayersReached extends XLAPIError
	name: "MaximumNumberOfPlayersReached"
	message: "This match can not accept any additional player"
	xtralifecode : 1

class AlreadyInvitedToMatch extends XLAPIError
	name: "AlreadyInvitedToMatch"
	message: "The player is already invited to the match"
	xtralifecode : 1

class InvalidLastEventId extends XLAPIError
	name: "InvalidLastEventId"
	message: "This event ID is invalid, please resynchronize"
	xtralifecode : 1

class ExternalStoreError extends XLAPIError
	constructor: (@serverresponse) -> 
		super()
		@message = "There was an error communicating with the external store, code: #{@serverresponse}"
	name: "ExternalStoreError"
	xtralifecode : 1

class MissingScore extends XLAPIError
	name: "MissingScore"
	message: "Gamer has never scored in specified leaderboard"
	xtralifecode : 2

class BadMatchID extends XLAPIError
	name: "BadMatchID"
	message: "This match does not exist or is not active"
	xtralifecode : 3

class BadGamerID extends XLAPIError
	name: "BadGamerID"
	message: "A passed gamer ID is invalid"
	xtralifecode : 3

class BadUserCredentials extends XLAPIError
	name: "BadUserCredentials"
	message: "Email and Password don't match"
	xtralifecode : 3

class InvalidProduct extends XLAPIError
	name: "InvalidProduct"
	message: "The product ID matches no product in the store"
	xtralifecode : 3

class DuplicateProduct extends XLAPIError
	name: "DuplicateProduct"
	message: "Either the product ID, or the equivalent product ID in one of the store is already defined"
	xtralifecode : 3

class MissingArgument extends XLAPIError
	name: "MissingArgument"
	message: "An argument is missing"
	xtralifecode : 4

class gamerDoesntHaveGodfather extends XLAPIError
	name: "gamerDoesntHaveGodfather"
	message: "the gamer doesn't have godfather yet"
	xtralifecode : 4

class RestrictedDomain extends  XLAPIError
	name: "RestrictedDomain"
	message: "Domain is not granted to the game"
	xtralifecode: 4

class BadPropertyType extends XLAPIError
	name: "BadPropertyType"
	message: "Properties only support basic types (number, string, boolean) or arrays of basic types"
	xtralifecode : 5

class MissingPropertyValue extends XLAPIError
	name: "MissingPropertyValue"
	message: "field value is missing"
	xtralifecode : 5

class QueryError extends XLAPIError
	constructor: (@message) -> super()
	name: "QueryError"
	xtralifecode : 7

class alreadyGodchild extends XLAPIError
	name: "alreadyGodchild"
	message: "gamer already have a godfather"
	xtralifecode : 8

class cantBeSelfGodchild extends XLAPIError
	name: "cantBeSelfGodchild"
	message: "gamers can't be godfather of themself"
	xtralifecode : 8

class unknownGodfatherCode extends XLAPIError
	name: "unknownGodfatherCode"
	message: "the godfather code is not found"
	xtralifecode : 9

class BadToken extends XLAPIError
	name: "BadToken"
	message: "The short login code is invalid"
	xtralifecode : 10

class tooLateRegistering extends XLAPIError
	name: "tooLateRegistering"
	message: "the gamer launch the game too many days ago to become a godchild"
	xtralifecode : 11

class PurchaseNotConfirmed extends XLAPIError
	constructor: (@serverresponse, detail) ->
		super()
		@message = "The purchase has not been verified, code: #{@serverresponse}"
		@message = "#{@message}. #{detail}." if detail
	name: "PurchaseNotConfirmed"
	xtralifecode : 12

class ExternalStoreEnvironmentError extends XLAPIError
	constructor: (@serverresponse) -> 
		super()
		@message= "You are trying to purchase an item from the sandbox in prod or vice versa, code : #{@serverresponse}"

	name: "ExternalStoreEnvironmentError"
	xtralifecode : 12

class ExternalStoreEnvironmentError extends XLAPIError
	name: "ExternalStoreEnvironmentError"
	message: "You are trying to purchase an item from the sandbox in prod or vice versa"
	xtralifecode : 12

class BalanceInsufficient extends XLAPIError
	name: "BalanceInsufficient"
	message: "balance is not high enough for transaction"
	xtralifecode : 19

class ConnectError extends XLAPIError
	constructor: (@message) -> super()
	name: "Error"
	xtralifecode : 20

class InternalError extends XLAPIError
	constructor: (@message) -> super()
	name: "InternalError"
	xtralifecode : 21

class ConcurrentModification extends  XLAPIError
	name: "ConcurrentModification"
	message: "The object was concurrently modified, you need to retry the request"
	xtralifecode: 91

class ExternalServerTempError extends XLAPIRetryableError
	constructor: (@serverresponse) ->
		super()
		@message= "An external server could not be reached, please try again later, code : #{@serverresponse}";

	name: "ExternalServerTempError"
	xtralifecode: 92

class PreconditionError extends XLAPIError
	constructor: (@errors) ->
		super()
		@message = "Incorrect parameters (#{@errors.join(',')})"

	name: "PreconditionError"
	xtralifecode: 1

class PreventRegistration extends XLAPIError
	constructor: (@details) ->
		super()
		@message = "PreventRegistration raised!"

	name: "PreventRegistration"
	xtralifecode: 1

class HookRecursionError extends XLAPIError
	constructor: (@message) -> super()
	name: "HookRecursionError"
	xtralifecode : 69

class HookError extends XLAPIError
	constructor: (@message) -> super()
	name: "HookError"
	xtralifecode : 68

class SponsorshipRefusedByHook extends XLAPIError
	name: "SponsorshipRefusedByHook"
	message : "The social-godfather hook refused sponsorship"
	xtralifecode : 70


module.exports = {XLAPIError, XLAPIRetryableError, InternalError
, ConnectError, PreventRegistration
, BadArgument, MissingArgument
, BadGamerID, BadUserCredentials
, BalanceInsufficient
, MissingScore, InvalidProduct, DuplicateProduct
, BadPropertyType, MissingPropertyValue
, alreadyGodchild, unknownGodfatherCode, tooLateRegistering, cantBeSelfGodchild, gamerDoesntHaveGodfather, SponsorshipRefusedByHook
, AlreadyJoinedMatch, BadMatchID, MaximumNumberOfPlayersReached, InvalidLastEventId, MatchNotFinished, MatchAlreadyFinished, AlreadyInvitedToMatch
, BadToken, RestrictedDomain
, QueryError, PreconditionError
, PurchaseNotConfirmed, ExternalStoreError, ExternalStoreEnvironmentError
, ConcurrentModification, HookRecursionError, HookError, ExternalServerTempError}
