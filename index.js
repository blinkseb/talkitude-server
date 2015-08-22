var fs = require('fs');
var restify = require('restify');
var restifyOAuth2 = require("restify-oauth2");
var hooks = require('./oauth2-hooks');
var crypto = require('crypto');

var mongoose = require('mongoose');
var Grid = require('gridfs-stream');
Grid.mongo = mongoose.mongo;

var models = require('./models');

// Read configuration
var config = {};
if (process.env.NODE_ENV === 'development') {
    config = JSON.parse(fs.readFileSync('./config/dev.json', 'utf8'));
} else {
    config = JSON.parse(fs.readFileSync('./config/prod.json', 'utf8'));
}

function postTalk(req, res, next) {
    if (!req.user) {
        return res.sendUnauthenticated();
    }

    if (! req.body.title) {
        return next(new restify.MissingParameterError("Parameter 'title' is missing"));
    }

    if (! req.body.venue) {
        return next(new restify.MissingParameterError("Parameter 'venue' is missing"));
    }

    if (! req.body.location) {
        return next(new restify.MissingParameterError("Parameter 'location' is missing"));
    }

    if (! req.body.type) {
        return next(new restify.MissingParameterError("Parameter 'type' is missing"));
    }

    if (! req.files.file) {
        return next(new restify.MissingParameterError("File is missing"));
    }


    if (models.TalkType.indexOf(req.body.type) == -1) {
        return next(new restify.InvalidArgumentError("Parameter 'type' is invalid"));
    }

    var talk = new models.TalkModel();
    talk.title = req.body.title;
    talk.venue = req.body.venue;
    talk.type = req.body.type;
    talk.location = req.body.location;

    if (req.body.date) {
        talk.date = new Date(req.body.date);
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

function deleteTalk(req, res, next) {
    if (!req.user) {
        return res.sendUnauthenticated();
    }

    if (! req.params.id) {
        return next(new restify.MissingParameterError("Parameter 'id' is missing"));
    }

    id = req.params.id;

    models.TalkModel.remove({_id: id}, function(err) {
        next.ifError(err);
        res.json({id: id});
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
    user.email = req.body.email;

    // Get salt
    var salt = crypto.randomBytes(256).toString('hex');
    user.salt = salt;

    hooks.hash(req.body.secret, salt, function(err, key) {
        user.secret = key.toString('hex');

        user.save(function(err) {
            next.ifError(err);
            console.info("New user " + user.email + " added.");
            res.end();
        });
    });
}

restify.CORS.ALLOW_HEADERS.push('authorization');

var server = restify.createServer();
server.use(restify.authorizationParser());
server.use(restify.bodyParser({ mapParams: false }));
server.use(restify.CORS());
restifyOAuth2.cc(server, {tokenEndpoint: '/token', hooks: hooks});

server.post('/talk', postTalk);
server.get('/talks', getTalks);
server.get('/download/:id', downloadFile);
server.del('/talk/:id', deleteTalk);

if (process.env.NODE_ENV == 'development') {
    server.post('/dev/user', devAddUser);
}

// Open DB connection
mongoose.connect('mongodb://' + config.DB_HOST + ':' + config.DB_PORT + '/' + config.DB_NAME);

var bind_ip = config.BIND_IP || '::';
var bind_port = config.BIND_PORT || 8080;

var nodeUserUid = config.UID || 'www-data';
var nodeUserGid = config.GID || 'www-data';

var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function (callback) {
    server.listen(bind_port, bind_ip, function() {
      if (process.env.NODE_ENV != 'development' && nodeUserUid && nodeUserGid) {
        console.log('Running as ' + nodeUserUid + ':' + nodeUserGid);
        process.setgid(nodeUserGid);
        process.setuid(nodeUserUid);
      }
      console.log('Listening at %s', server.url);
      console.log('Talkitude is up and running!');
    });
});
