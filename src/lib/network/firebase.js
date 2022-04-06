const firebaseAuth = require("firebase-admin/auth");

const validToken = (token, firebaseApp, cb) => {
  return firebaseAuth
    .getAuth(firebaseApp)
    .verifyIdToken(token)
    .then((me) => cb(null, me))
    .catch((err) => {
      err.source = "firebase";
      return cb(err, null);
    });
};

module.exports.validToken = validToken;
