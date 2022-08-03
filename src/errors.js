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
		if(message) this.message = message
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
BadArgument.prototype.name = "BadArgument";
BadArgument.prototype.message = "A passed argument is invalid";
BadArgument.prototype.xtralifecode = 1;

class AlreadyJoinedMatch extends XLAPIError { }
AlreadyJoinedMatch.prototype.name = "AlreadyJoinedMatch";
AlreadyJoinedMatch.prototype.message = "You are already being part of this match";
AlreadyJoinedMatch.prototype.xtralifecode = 1;

class NoShoeInMatch extends XLAPIError { }
NoShoeInMatch.prototype.name = "NoShoeInMatch";
NoShoeInMatch.prototype.message = "Unable to draw from shoe unless items have been put in it at creation";
NoShoeInMatch.prototype.xtralifecode = 1;

class MatchNotFinished extends XLAPIError { }
MatchNotFinished.prototype.name = "MatchNotFinished";
MatchNotFinished.prototype.message = "This match needs to be finished in order to perform this operation";
MatchNotFinished.prototype.xtralifecode = 1;

class MatchAlreadyFinished extends XLAPIError { }
MatchAlreadyFinished.prototype.name = "MatchAlreadyFinished";
MatchAlreadyFinished.prototype.message = "This match is already finished";
MatchAlreadyFinished.prototype.xtralifecode = 1;

class MaximumNumberOfPlayersReached extends XLAPIError { }
MaximumNumberOfPlayersReached.prototype.name = "MaximumNumberOfPlayersReached";
MaximumNumberOfPlayersReached.prototype.message = "This match can not accept any additional player";
MaximumNumberOfPlayersReached.prototype.xtralifecode = 1;

class AlreadyInvitedToMatch extends XLAPIError { }
AlreadyInvitedToMatch.prototype.name = "AlreadyInvitedToMatch";
AlreadyInvitedToMatch.prototype.message = "The player is already invited to the match";
AlreadyInvitedToMatch.prototype.xtralifecode = 1;

class InvalidLastEventId extends XLAPIError { }
InvalidLastEventId.prototype.name = "InvalidLastEventId";
InvalidLastEventId.prototype.message = "This event ID is invalid, please resynchronize";
InvalidLastEventId.prototype.xtralifecode = 1;

class ExternalStoreError extends XLAPIError {
	constructor(serverresponse) {
		super();
		this.serverresponse = serverresponse;
		this.message = `There was an error communicating with the external store, code: ${this.serverresponse}`;
	}
}
ExternalStoreError.prototype.name = "ExternalStoreError";
ExternalStoreError.prototype.xtralifecode = 1;

class MissingScore extends XLAPIError { }
MissingScore.prototype.name = "MissingScore";
MissingScore.prototype.message = "Gamer has never scored in specified leaderboard";
MissingScore.prototype.xtralifecode = 2;

class BadMatchID extends XLAPIError { }
BadMatchID.prototype.name = "BadMatchID";
BadMatchID.prototype.message = "This match does not exist or is not active";
BadMatchID.prototype.xtralifecode = 3;

class BadGamerID extends XLAPIError { }
BadGamerID.prototype.name = "BadGamerID";
BadGamerID.prototype.message = "A passed gamer ID is invalid";
BadGamerID.prototype.xtralifecode = 3;

class BadUserCredentials extends XLAPIError {}
BadUserCredentials.prototype.name = "BadUserCredentials";
BadUserCredentials.prototype.message = "Email and Password don't match";
BadUserCredentials.prototype.xtralifecode = 3;

class InvalidProduct extends XLAPIError {}
InvalidProduct.prototype.name = "InvalidProduct";
InvalidProduct.prototype.message = "The product ID matches no product in the store";
InvalidProduct.prototype.xtralifecode = 3;

class DuplicateProduct extends XLAPIError {}
DuplicateProduct.prototype.name = "DuplicateProduct";
DuplicateProduct.prototype.message = "Either the product ID, or the equivalent product ID in one of the store is already defined";
DuplicateProduct.prototype.xtralifecode = 3;

class MissingArgument extends XLAPIError {}
MissingArgument.prototype.name = "MissingArgument";
MissingArgument.prototype.message = "An argument is missing";
MissingArgument.prototype.xtralifecode = 4;

class gamerDoesntHaveGodfather extends XLAPIError {
}
gamerDoesntHaveGodfather.prototype.name = "gamerDoesntHaveGodfather";
gamerDoesntHaveGodfather.prototype.message = "the gamer doesn't have godfather yet";
gamerDoesntHaveGodfather.prototype.xtralifecode = 4;

class RestrictedDomain extends XLAPIError {
}
RestrictedDomain.prototype.name = "RestrictedDomain";
RestrictedDomain.prototype.message = "Domain is not granted to the game";
RestrictedDomain.prototype.xtralifecode = 4;

class BadPropertyType extends XLAPIError {
}
BadPropertyType.prototype.name = "BadPropertyType";
BadPropertyType.prototype.message = "Properties only support basic types (number, string, boolean) or arrays of basic types";
BadPropertyType.prototype.xtralifecode = 5;

class MissingPropertyValue extends XLAPIError {
}
MissingPropertyValue.prototype.name = "MissingPropertyValue";
MissingPropertyValue.prototype.message = "field value is missing";
MissingPropertyValue.prototype.xtralifecode = 5;

class QueryError extends XLAPIError {
	constructor(message) {
		super();
		this.message = message;
	}
}
QueryError.prototype.name = "QueryError";
QueryError.prototype.xtralifecode = 7;

class alreadyGodchild extends XLAPIError {
}
alreadyGodchild.prototype.name = "alreadyGodchild";
alreadyGodchild.prototype.message = "gamer already have a godfather";
alreadyGodchild.prototype.xtralifecode = 8;

class cantBeSelfGodchild extends XLAPIError {
}
cantBeSelfGodchild.prototype.name = "cantBeSelfGodchild";
cantBeSelfGodchild.prototype.message = "gamers can't be godfather of themself";
cantBeSelfGodchild.prototype.xtralifecode = 8;

class unknownGodfatherCode extends XLAPIError {
}
unknownGodfatherCode.prototype.name = "unknownGodfatherCode";
unknownGodfatherCode.prototype.message = "the godfather code is not found";
unknownGodfatherCode.prototype.xtralifecode = 9;

class GameCenterError extends XLAPIError {
	constructor(message) {
		super();
		this.message = message;
	}
}
GameCenterError.prototype.name = "GameCenterLoginError";
GameCenterError.prototype.xtralifecode = 99;

class BadToken extends XLAPIError {
}
BadToken.prototype.name = "BadToken";
BadToken.prototype.message = "The short login code is invalid";
BadToken.prototype.xtralifecode = 10;

class tooLateRegistering extends XLAPIError {
}
tooLateRegistering.prototype.name = "tooLateRegistering";
tooLateRegistering.prototype.message = "the gamer launch the game too many days ago to become a godchild";
tooLateRegistering.prototype.xtralifecode = 11;

class PurchaseNotConfirmed extends XLAPIError {
	constructor(serverresponse, detail) {
		super();
		this.serverresponse = serverresponse;
		this.message = `The purchase has not been verified, code: ${this.serverresponse}`;
		if (detail) { this.message = `${this.message}. ${detail}.`; }
	}
}
PurchaseNotConfirmed.prototype.name = "PurchaseNotConfirmed";
PurchaseNotConfirmed.prototype.xtralifecode = 12;

class ExternalStoreEnvironmentError extends XLAPIError {
	constructor(serverresponse) {
		super();
		this.serverresponse = serverresponse;
		this.message = `You are trying to purchase an item from the sandbox in prod or vice versa, code : ${this.serverresponse}`;
	}
}
ExternalStoreEnvironmentError.prototype.name = "ExternalStoreEnvironmentError";
ExternalStoreEnvironmentError.prototype.message = "You are trying to purchase an item from the sandbox in prod or vice versa";
ExternalStoreEnvironmentError.prototype.xtralifecode = 12;

class BalanceInsufficient extends XLAPIError {
}
BalanceInsufficient.prototype.name = "BalanceInsufficient";
BalanceInsufficient.prototype.message = "balance is not high enough for transaction";
BalanceInsufficient.prototype.xtralifecode = 19;

class ConnectError extends XLAPIError {
	constructor(message) {
		super();
		this.message = message;
	}
}
ConnectError.prototype.name = "Error";
ConnectError.prototype.xtralifecode = 20;

class InternalError extends XLAPIError {
	constructor(message) {
		super();
		this.message = message;
	}
}
InternalError.prototype.name = "InternalError";
InternalError.prototype.xtralifecode = 21;

class ConcurrentModification extends XLAPIError {
}
ConcurrentModification.prototype.name = "ConcurrentModification";
ConcurrentModification.prototype.message = "The object was concurrently modified, you need to retry the request";
ConcurrentModification.prototype.xtralifecode = 91;

class ExternalServerTempError extends XLAPIRetryableError {
	constructor(serverresponse) {
		super();
		this.serverresponse = serverresponse;
		this.message = `An external server could not be reached, please try again later, code : ${this.serverresponse}`;
	}
}
ExternalServerTempError.prototype.name = "ExternalServerTempError";
ExternalServerTempError.prototype.xtralifecode = 92;

class PreconditionError extends XLAPIError {
	constructor(errors) {
		super();
		this.errors = errors;
		this.message = `Incorrect parameters (${this.errors.join(',')})`;
	}
}
PreconditionError.prototype.name = "PreconditionError";
PreconditionError.prototype.xtralifecode = 1;

class PreventRegistration extends XLAPIError {
	constructor(details) {
		super();
		this.details = details;
		this.message = "PreventRegistration raised!";
	}
}
PreventRegistration.prototype.name = "PreventRegistration";
PreventRegistration.prototype.xtralifecode = 1;

class HookRecursionError extends XLAPIError {
	constructor(message) {
		super();
		this.message = message;
	}
}
HookRecursionError.prototype.name = "HookRecursionError";
HookRecursionError.prototype.xtralifecode = 69;

class HookError extends XLAPIError {
	constructor(message) {
		super();
		this.message = message;
	}
}
HookError.prototype.name = "HookError";
HookError.prototype.xtralifecode = 68;

class SponsorshipRefusedByHook extends XLAPIError {
}
SponsorshipRefusedByHook.prototype.name = "SponsorshipRefusedByHook";
SponsorshipRefusedByHook.prototype.message = "The social-godfather hook refused sponsorship";
SponsorshipRefusedByHook.prototype.xtralifecode = 70;

class MissingGoogleClientID extends XLAPIError {}
MissingGoogleClientID.prototype.name = "MissingGoogleClientID";
MissingGoogleClientID.prototype.message = "Missing google client ID in config file";
MissingGoogleClientID.prototype.xtralifecode = 1;


class MissingFirebaseCredentials extends XLAPIError {}
MissingFirebaseCredentials.prototype.name = "MissingFirebaseCredentials";
MissingFirebaseCredentials.prototype.message = "Missing firebase credentials in config file";
MissingFirebaseCredentials.prototype.xtralifecode = 1;

class MissingSteamCredentials extends XLAPIError {}
MissingSteamCredentials.prototype.name = "MissingSteamCredentials";
MissingSteamCredentials.prototype.message = "Missing steam credentials in config file";
MissingSteamCredentials.prototype.xtralifecode = 1;

class MissingAppleClientID extends XLAPIError {}
MissingAppleClientID.prototype.name = "MissingAppleClientID";
MissingAppleClientID.prototype.message = "Missing apple client ID in config file";
MissingAppleClientID.prototype.xtralifecode = 1;

class FacebookError extends XLAPIError {
	static initClass() {
		this.prototype.name = "FacebookError";
	}
	constructor(message, details) {
		super(message);
		this.details = details;
	}
}
FacebookError.initClass();

class GoogleError extends XLAPIError {
	static initClass() {
		this.prototype.name = "GoogleError";
	}
	constructor(message, details) {
		super(message);
		this.details = details;
	}
}
GoogleError.initClass();

class FirebaseError extends XLAPIError {
	static initClass() {
		this.prototype.name = "FirebaseError";
	}
	constructor(message, details) {
		super(message);
		this.details = details;
	}
}
FirebaseError.initClass();
class SteamError extends XLAPIError {
	static initClass() {
		this.prototype.name = "SteamError";
	}
	constructor(message, details) {
		super(message);
		this.details = details;
	}
}
SteamError.initClass();
class AppleError extends XLAPIError {
	static initClass() {
		this.prototype.name = "AppleError";
	}
	constructor(message, details) {
		super(message);
		this.details = details;
	}
}
AppleError.initClass();


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
	, GameCenterError, MissingGoogleClientID, MissingFirebaseCredentials, MissingSteamCredentials, FacebookError, GoogleError, FirebaseError, SteamError
	, AppleError, MissingAppleClientID
};
