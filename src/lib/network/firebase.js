const firebaseAuth = require("firebase-admin/auth");
const {FirebaseError} = require("../../errors");

const validToken = (token, firebaseApp, cb) => {
  return firebaseAuth
    .getAuth(firebaseApp)
    .verifyIdToken(token)
    .then((me) => cb(null, me))
    .catch((err) => {
      const message = err.message || err.errorInfo?.message
      const details = err.errorInfo
      if(details) delete details.message
      return cb(new FirebaseError(message, details));
    });
};

module.exports.validToken = validToken;
