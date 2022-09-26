const superagent = require("superagent");
const { EpicError } = require("../../errors");

//call epic verify token to get the epic id
const validToken = (authToken, cb) => {
    let endpoint = "https://api.epicgames.dev/epic/oauth/v1/tokenInfo";

    return superagent
        .post(endpoint)
        .accept("json")
        .set("Accept-Encoding", "gzip, deflate")
        .set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
        .type('form')
        .send({ token: authToken })
        .end((err, res) => {
            if (err != null) {
                return cb(new EpicError(err.message, res.body.errorMessage), null);
            }
            if (res.body.active === true) {
                return cb(null, res.body);
            } else {
                return cb(new EpicError(res.body.active), null);
            }
        });
};

module.exports.validToken = validToken;