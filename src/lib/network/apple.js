const appleAuth = require("apple-signin-auth");

const validToken = async (token, clientID, cb) => {
    try {
        const user = await appleAuth.verifyIdToken(
          token,
          {
            audience: clientID,
            ignoreExpiration: true,
          }
        );
        console.log(user);
        return cb(null, user);
      } catch (err) {
        err.source = "apple";
        return cb(err, null);
      }
}

module.exports.validToken = validToken;
