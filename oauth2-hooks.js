"use strict";

var crypto = require("crypto");

// DB
var mongoose = require('mongoose');
var models = require('./models');

function hash(password, salt, callback) {
    crypto.pbkdf2(password, salt, 10000, 512, 'sha512', function(err, key) {
        callback(err, key);
    });
}

exports.hash = hash;

function generateToken(data) {
    var random = Math.floor(Math.random() * 100001);
    var timestamp = (new Date()).getTime();
    var sha256 = crypto.createHmac("sha256", random + "AFDEF" + timestamp);

    return sha256.update(data).digest("base64");
}

exports.grantClientToken = function (credentials, req, cb) {
    models.User.findOne({email: credentials.clientId}, function(err, user) {

        if ((err) || (!user))
            return cb(null, false);

        // Check secret
        hash(credentials.clientSecret, user.salt, function(err, key) {
            if (err)
                cb(null, false);

            var clientSecret = key.toString('hex');
            if (clientSecret === user.secret) {
                var token = new models.Token();
                token.user = user._id;
                token.token = generateToken(user.email + ":" + user.secret);
                var validUntil = new Date();
                validUntil.setDate(validUntil.getDate() + 10);
                token.validUntil = validUntil;

                token.save(function (err) {
                    if (err)
                        return cb(null, false);

                    return cb(null, token.token);
                });
            } else
                return cb(null, false);
        });
    });
};

exports.authenticateToken = function (token, req, cb) {
    models.Token.findOne({token: token}, function(err, token) {
        if (err || !token)
            return cb(null, false);

        var now = new Date();
        if (token.validUntil <= now) {
            // Delete token
            models.Token.find().remove({_id: token._id}, function(err) {});
            return cb(null, false);
        }

        req.user = token.user;
        return cb(null, true);
    });
};
