const appleAuth = require("apple-signin-auth");
const {AppleError} = require("../../errors");

const validToken = async (token, clientID, cb) => {
    try {
        const user = await appleAuth.verifyIdToken(
          token,
          {
            audience: clientID,
            ignoreExpiration: true,
          }
        );
        return cb(null, user);
      } catch (err) {
        return cb(new AppleError(err.message), null);
      }
}

module.exports.validToken = validToken;
