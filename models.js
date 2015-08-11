var mongoose = require('mongoose');

Schema = mongoose.Schema;

var TalkType = 'cms_meeting cms_workshop public_national public_international internal other'.split(' ')

var TalkSchema = new Schema({
    title: String,
    location: String,
    type: {type: String, enum: TalkType},
    date: {type: Date, default: Date.now},
    file: mongoose.Schema.Types.ObjectId
});

var FileSchema = new Schema({
    filename: String,
    length: Number,
    uploadDate: Date,
    md5: String
});

var UserSchema = new Schema({
    email: String,
    salt: String,
    secret: String
});

var TokenSchema = new Schema({
    token: String,
    user: mongoose.Schema.Types.ObjectId,
    validUntil: Date
});

var TalkModel = mongoose.model('Talk', TalkSchema);
var FileModel = mongoose.model('fs.file', FileSchema);
var Token = mongoose.model('Token', TokenSchema);
var User = mongoose.model('User', UserSchema);

exports.TalkType = TalkType
exports.TalkModel = TalkModel
exports.FileModel = FileModel
exports.Token = Token
exports.User = User
