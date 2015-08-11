var fs = require('fs');
var restify = require('restify');
var restifyOAuth2 = require("restify-oauth2");
var hooks = require('./oauth2-hooks');
var crypto = require('crypto');

var mongoose = require('mongoose');
var Grid = require('gridfs-stream');
Grid.mongo = mongoose.mongo;

var models = require('./models');

function postTalk(req, res, next) {
    if (!req.user) {
        return res.sendUnauthenticated();
    }

    if (! req.params.title) {
        return next(new restify.MissingParameterError("Parameter 'title' is missing"));
    }

    if (! req.params.location) {
        return next(new restify.MissingParameterError("Parameter 'location' is missing"));
    }

    if (! req.params.type) {
        return next(new restify.MissingParameterError("Parameter 'type' is missing"));
    }

    if (! req.files.file) {
        return next(new restify.MissingParameterError("File is missing"));
    }


    if (models.TalkType.indexOf(req.params.type) == -1) {
        return next(new restify.InvalidArgumentError("Parameter 'type' is invalid"));
    }

    var talk = new models.TalkModel();
    talk.title = req.params.title;
    talk.type = req.params.type;
    talk.location = req.params.location;

    if ((req.params.day) && (req.params.month) && (req.params.year)) {
        talk.date = new Date(req.params.year, req.params.month, req.params.day); 
    }

    // Store file into GridFS
    var gfs = Grid(mongoose.connection.db);
    var writestream = gfs.createWriteStream({
        filename: req.files.file.name,
        mode:'w',
        content_type: req.files.file.mimetype
    });
    
    var readstream = fs.createReadStream(req.files.file.path);
    readstream.pipe(writestream); 

    writestream.on('error', function (error) {
        return next(new restify.InternalError('Failed to save object to database: file upload error'));
    });

    writestream.on('close', function (file) {
        talk.file = file._id;

        // Delete temporary file
        fs.unlink(req.files.file.path);

        talk.save(function (err) {
            if (err) {
                return next(new restify.InternalError('Failed to save object to database'));
            }

            console.log('New talk inserted into the database: ' + talk._id);
            res.json({id: talk._id});
        });
    
    });
}

function getTalks(req, res, next) {
    if (!req.user) {
        return res.sendUnauthenticated();
    }

    models.TalkModel.find({}).exec(function(err, talks) {
        models.FileModel.populate(talks, {path: 'file'}, function(err, talks) {
            res.json(talks);  
        });
    });
}

function downloadFile(req, res, next) {
    if (!req.user) {
        return res.sendUnauthenticated();
    }

    if (! req.params.id) {
        return next(new restify.MissingParameterError("Parameter 'id' is missing"));
    }

    id = req.params.id;

    var gfs = Grid(mongoose.connection.db);
    gfs.files.findOne({_id: mongoose.mongo.ObjectID(id)}, function(err, file) {
        if (err || !file) {
            return next(new restify.NotFoundError());
        }

        res.setHeader('content-type', 'application/pdf');
        res.setHeader('content-length', file.length);

        var readstream = gfs.createReadStream({_id: file._id});
        readstream.pipe(res);
    });
}

function devAddUser(req, res, next) {

    user = new models.User();
    user.email = req.params.email;

    // Get salt
    var salt = crypto.randomBytes(256).toString('hex');
    user.salt = salt;

    hooks.hash(req.params.secret, salt, function(err, key) {
        user.secret = key.toString('hex');

        user.save(function(err) {
            next.ifError(err);
            res.end();
        });
    });
}

var server = restify.createServer();
server.use(restify.authorizationParser());
server.use(restify.bodyParser());
restifyOAuth2.cc(server, {tokenEndpoint: '/token', hooks: hooks});

server.post('/talk', postTalk);
server.get('/talks', getTalks);
server.get('/download/:id', downloadFile);

if (process.env.NODE_ENV == 'development') {
    server.post('/dev/user', devAddUser);
}

// Open DB connection
mongoose.connect('mongodb://localhost/talks')

var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function (callback) {
    server.listen(8080, function() {
      console.log('Listening at %s', server.url);
      console.log('Talkitude is up and running!');
    });
});