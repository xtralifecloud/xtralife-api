//@ts-check
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS206: Consider reworking classes to avoid initClass
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */

class XLAPIError extends Error {
	constructor(message) {
		super();
		this.message = message
	}

	isRetryable() { return false; }

	// we can implement @getMessage OR define @message. getMessage has precedence
	getMessage() {
		return this.message;
	}
}

class XLAPIRetryableError extends XLAPIError {
	constructor() {
		super();
	}

	isRetryable() { return true; }
}

class BadArgument extends XLAPIError { 
	constructor(message) {
		super(message);
	}
}
BadArgument.name = "BadArgument";
BadArgument.message = "A passed argument is invalid";
BadArgument.xtralifecode = 1;

class AlreadyJoinedMatch extends XLAPIError { }
AlreadyJoinedMatch.name = "AlreadyJoinedMatch";
AlreadyJoinedMatch.message = "You are already being part of this match";
AlreadyJoinedMatch.xtralifecode = 1;

class NoShoeInMatch extends XLAPIError { }
NoShoeInMatch.name = "NoShoeInMatch";
NoShoeInMatch.message = "Unable to draw from shoe unless items have been put in it at creation";
NoShoeInMatch.xtralifecode = 1;

class MatchNotFinished extends XLAPIError { }
MatchNotFinished.name = "MatchNotFinished";
MatchNotFinished.message = "This match needs to be finished in order to perform this operation";
MatchNotFinished.xtralifecode = 1;

class MatchAlreadyFinished extends XLAPIError { }
MatchAlreadyFinished.name = "MatchAlreadyFinished";
MatchAlreadyFinished.message = "This match is already finished";
MatchAlreadyFinished.xtralifecode = 1;

class MaximumNumberOfPlayersReached extends XLAPIError { }
MaximumNumberOfPlayersReached.name = "MaximumNumberOfPlayersReached";
MaximumNumberOfPlayersReached.message = "This match can not accept any additional player";
MaximumNumberOfPlayersReached.xtralifecode = 1;

class AlreadyInvitedToMatch extends XLAPIError { }
AlreadyInvitedToMatch.name = "AlreadyInvitedToMatch";
AlreadyInvitedToMatch.message = "The player is already invited to the match";
AlreadyInvitedToMatch.xtralifecode = 1;

class InvalidLastEventId extends XLAPIError { }
InvalidLastEventId.name = "InvalidLastEventId";
InvalidLastEventId.message = "This event ID is invalid, please resynchronize";
InvalidLastEventId.xtralifecode = 1;

class ExternalStoreError extends XLAPIError {
	constructor(serverresponse) {
		super();
		this.serverresponse = serverresponse;
		this.message = `There was an error communicating with the external store, code: ${this.serverresponse}`;
	}
}
ExternalStoreError.name = "ExternalStoreError";
ExternalStoreError.xtralifecode = 1;

class MissingScore extends XLAPIError { }
MissingScore.name = "MissingScore";
MissingScore.message = "Gamer has never scored in specified leaderboard";
MissingScore.xtralifecode = 2;

class BadMatchID extends XLAPIError { }
BadMatchID.name = "BadMatchID";
BadMatchID.message = "This match does not exist or is not active";
BadMatchID.xtralifecode = 3;

class BadGamerID extends XLAPIError { }
BadGamerID.name = "BadGamerID";
BadGamerID.message = "A passed gamer ID is invalid";
BadGamerID.xtralifecode = 3;

class BadUserCredentials extends XLAPIError {
	static initClass() {
		this.prototype.name = "BadUserCredentials";
		this.prototype.message = "Email and Password don't match";
		this.prototype.xtralifecode = 3;
	}
}
BadUserCredentials.initClass();

class InvalidProduct extends XLAPIError {
	static initClass() {
		this.prototype.name = "InvalidProduct";
		this.prototype.message = "The product ID matches no product in the store";
		this.prototype.xtralifecode = 3;
	}
}
InvalidProduct.initClass();

class DuplicateProduct extends XLAPIError {
	static initClass() {
		this.prototype.name = "DuplicateProduct";
		this.prototype.message = "Either the product ID, or the equivalent product ID in one of the store is already defined";
		this.prototype.xtralifecode = 3;
	}
}
DuplicateProduct.initClass();

class MissingArgument extends XLAPIError {
	static initClass() {
		this.prototype.name = "MissingArgument";
		this.prototype.message = "An argument is missing";
		this.prototype.xtralifecode = 4;
	}
}
MissingArgument.initClass();

class gamerDoesntHaveGodfather extends XLAPIError {
	static initClass() {
		this.prototype.name = "gamerDoesntHaveGodfather";
		this.prototype.message = "the gamer doesn't have godfather yet";
		this.prototype.xtralifecode = 4;
	}
}
gamerDoesntHaveGodfather.initClass();

class RestrictedDomain extends XLAPIError {
	static initClass() {
		this.prototype.name = "RestrictedDomain";
		this.prototype.message = "Domain is not granted to the game";
		this.prototype.xtralifecode = 4;
	}
}
RestrictedDomain.initClass();

class BadPropertyType extends XLAPIError {
	static initClass() {
		this.prototype.name = "BadPropertyType";
		this.prototype.message = "Properties only support basic types (number, string, boolean) or arrays of basic types";
		this.prototype.xtralifecode = 5;
	}
}
BadPropertyType.initClass();

class MissingPropertyValue extends XLAPIError {
	static initClass() {
		this.prototype.name = "MissingPropertyValue";
		this.prototype.message = "field value is missing";
		this.prototype.xtralifecode = 5;
	}
}
MissingPropertyValue.initClass();

class QueryError extends XLAPIError {
	static initClass() {
		this.prototype.name = "QueryError";
		this.prototype.xtralifecode = 7;
	}
	constructor(message) {
		super();
		this.message = message;
	}
}
QueryError.initClass();

class alreadyGodchild extends XLAPIError {
	static initClass() {
		this.prototype.name = "alreadyGodchild";
		this.prototype.message = "gamer already have a godfather";
		this.prototype.xtralifecode = 8;
	}
}
alreadyGodchild.initClass();

class cantBeSelfGodchild extends XLAPIError {
	static initClass() {
		this.prototype.name = "cantBeSelfGodchild";
		this.prototype.message = "gamers can't be godfather of themself";
		this.prototype.xtralifecode = 8;
	}
}
cantBeSelfGodchild.initClass();

class unknownGodfatherCode extends XLAPIError {
	static initClass() {
		this.prototype.name = "unknownGodfatherCode";
		this.prototype.message = "the godfather code is not found";
		this.prototype.xtralifecode = 9;
	}
}
unknownGodfatherCode.initClass();

class GameCenterError extends XLAPIError {
	static initClass() {
		this.prototype.name = "GameCenterLoginError";
		this.prototype.xtralifecode = 99;
	}
	constructor(message) {
		super();
		this.message = message;
	}
}
GameCenterError.initClass();

class BadToken extends XLAPIError {
	static initClass() {
		this.prototype.name = "BadToken";
		this.prototype.message = "The short login code is invalid";
		this.prototype.xtralifecode = 10;
	}
}
BadToken.initClass();

class tooLateRegistering extends XLAPIError {
	static initClass() {
		this.prototype.name = "tooLateRegistering";
		this.prototype.message = "the gamer launch the game too many days ago to become a godchild";
		this.prototype.xtralifecode = 11;
	}
}
tooLateRegistering.initClass();

class PurchaseNotConfirmed extends XLAPIError {
	static initClass() {
		this.prototype.name = "PurchaseNotConfirmed";
		this.prototype.xtralifecode = 12;
	}
	constructor(serverresponse, detail) {
		super();
		this.serverresponse = serverresponse;
		this.message = `The purchase has not been verified, code: ${this.serverresponse}`;
		if (detail) { this.message = `${this.message}. ${detail}.`; }
	}
}
PurchaseNotConfirmed.initClass();

class ExternalStoreEnvironmentError extends XLAPIError {
	static initClass() {

		this.prototype.name = "ExternalStoreEnvironmentError";
		this.prototype.xtralifecode = 12;
	}
	constructor(serverresponse) {
		super();
		this.serverresponse = serverresponse;
		this.message = `You are trying to purchase an item from the sandbox in prod or vice versa, code : ${this.serverresponse}`;
	}
}
ExternalStoreEnvironmentError.initClass();

ExternalStoreEnvironmentError = class ExternalStoreEnvironmentError extends XLAPIError {
	static initClass() {
		this.prototype.name = "ExternalStoreEnvironmentError";
		this.prototype.message = "You are trying to purchase an item from the sandbox in prod or vice versa";
		this.prototype.xtralifecode = 12;
	}
};
ExternalStoreEnvironmentError.initClass();

class BalanceInsufficient extends XLAPIError {
	static initClass() {
		this.prototype.name = "BalanceInsufficient";
		this.prototype.message = "balance is not high enough for transaction";
		this.prototype.xtralifecode = 19;
	}
}
BalanceInsufficient.initClass();

class ConnectError extends XLAPIError {
	static initClass() {
		this.prototype.name = "Error";
		this.prototype.xtralifecode = 20;
	}
	constructor(message) {
		super();
		this.message = message;
	}
}
ConnectError.initClass();

class InternalError extends XLAPIError {
	static initClass() {
		this.prototype.name = "InternalError";
		this.prototype.xtralifecode = 21;
	}
	constructor(message) {
		super();
		this.message = message;
	}
}
InternalError.initClass();

class ConcurrentModification extends XLAPIError {
	static initClass() {
		this.prototype.name = "ConcurrentModification";
		this.prototype.message = "The object was concurrently modified, you need to retry the request";
		this.prototype.xtralifecode = 91;
	}
}
ConcurrentModification.initClass();

class ExternalServerTempError extends XLAPIRetryableError {
	static initClass() {

		this.prototype.name = "ExternalServerTempError";
		this.prototype.xtralifecode = 92;
	}
	constructor(serverresponse) {
		super();
		this.serverresponse = serverresponse;
		this.message = `An external server could not be reached, please try again later, code : ${this.serverresponse}`;
	}
}
ExternalServerTempError.initClass();

class PreconditionError extends XLAPIError {
	static initClass() {

		this.prototype.name = "PreconditionError";
		this.prototype.xtralifecode = 1;
	}
	constructor(errors) {
		super();
		this.errors = errors;
		this.message = `Incorrect parameters (${this.errors.join(',')})`;
	}
}
PreconditionError.initClass();

class PreventRegistration extends XLAPIError {
	static initClass() {

		this.prototype.name = "PreventRegistration";
		this.prototype.xtralifecode = 1;
	}
	constructor(details) {
		super();
		this.details = details;
		this.message = "PreventRegistration raised!";
	}
}
PreventRegistration.initClass();

class HookRecursionError extends XLAPIError {
	static initClass() {
		this.prototype.name = "HookRecursionError";
		this.prototype.xtralifecode = 69;
	}
	constructor(message) {
		super();
		this.message = message;
	}
}
HookRecursionError.initClass();

class HookError extends XLAPIError {
	static initClass() {
		this.prototype.name = "HookError";
		this.prototype.xtralifecode = 68;
	}
	constructor(message) {
		super();
		this.message = message;
	}
}
HookError.initClass();

class SponsorshipRefusedByHook extends XLAPIError {
	static initClass() {
		this.prototype.name = "SponsorshipRefusedByHook";
		this.prototype.message = "The social-godfather hook refused sponsorship";
		this.prototype.xtralifecode = 70;
	}
}
SponsorshipRefusedByHook.initClass();


module.exports = {
	XLAPIError, XLAPIRetryableError, InternalError
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
	, ConcurrentModification, HookRecursionError, HookError, ExternalServerTempError
	, GameCenterError
};
