// Copyright 2012-2018 (c) Peter Širka <petersirka@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/**
 * @module NoSQL
 * @version 3.0.0
 */

'use strict';

const Fs = require('fs');
const Path = require('path');
const NoSQLStream = require('./nosqlstream');

if (!global.framework_utils)
	global.framework_utils = require('./utils');

if (!global.framework_image)
	global.framework_image = require('./image');

if (!global.framework_nosql)
	global.framework_nosql = exports;

if (!global.framework_builders)
	global.framework_builders = require('./builders');

const EXTENSION = '.nosql';
const EXTENSION_TABLE = '.table';
const EXTENSION_TABLE_BACKUP = '.table-backup';
const EXTENSION_BINARY = '.nosql-binary';
const EXTENSION_TMP = '.nosql-tmp';
const EXTENSION_LOG = '.nosql-log';
const EXTENSION_MAPREDUCE = '.nosql-mapreduce';
const EXTENSION_BACKUP = '.nosql-backup';
const EXTENSION_META = '.meta';
const EXTENSION_COUNTER = '-counter2';
const BINARY_HEADER_LENGTH = 2000;
const COUNTER_MMA = [0, 0];
const DIRECTORYLENGTH = 9;
const FLAGS_READ = ['get'];
const INMEMORY = {};
const JSONBOOL = '":true ';
const NEWLINE = '\n';
const REGBOOL = /":true/g; // for updates of boolean types
const REGCHINA = /[\u3400-\u9FBF]/;
const REGCLEAN = /^[\s]+|[\s]+$/g;
const REGTESCAPE = /\||\n|\r/g;
const REGTUNESCAPE = /%7C|%0D|%0A/g;
const REGTESCAPETEST = /\||\n|\r/;
const IMAGES = { gif: 1, jpg: 1, jpeg: 1, png: 1, svg: 1 };
const BINARYREADDATA = { start: BINARY_HEADER_LENGTH };
const BINARYREADDATABASE64 = { start: BINARY_HEADER_LENGTH, encoding: 'base64' };
const BINARYREADMETA = { start: 0, end: BINARY_HEADER_LENGTH - 1, encoding: 'binary' };
const BOOLEAN = { '1': 1, 'true': 1, 'on': 1 };
const TABLERECORD = { '+': 1, '-': 1, '*': 1 };

const COMPARER = global.Intl ? global.Intl.Collator().compare : function(a, b) {
	return a.removeDiacritics().localeCompare(b.removeDiacritics());
};

const NEWLINEBUF = framework_utils.createBuffer('\n', 'utf8');
const CACHE = {};

var JSONBUFFER = process.argv.findIndex(n => n.endsWith('nosqlworker.js')) === -1 ? 20 : 40;
var FORK;
var FORKCALLBACKS;

function promise(fn) {
	var self = this;
	return new Promise(function(resolve, reject) {
		self.callback(function(err, result) {
			if (err)
				reject(err);
			else
				resolve(fn == null ? result : fn(result));
		});
	});
}

exports.kill = function(signal) {
	FORK && TRY(() => FORK && FORK.kill && FORK.kill(signal || 'SIGTERM'));
};

exports.pid = function() {
	return FORK ? FORK.pid : 0;
};

exports.worker = function() {

	if (FORK)
		return;

	// Clears unhandled callbacks
	ON('service', function() {

		var keys = Object.keys(FORKCALLBACKS);
		if (!keys.length)
			return;

		var time = Date.now();

		for (var i = 0, length = keys.length; i < length; i++) {
			var key = keys[i];
			var item = FORKCALLBACKS[key];
			if (item && item.time) {
				var diff = time - item.time;
				if (diff >= 60000) {
					delete FORKCALLBACKS[key];
					var err = new Error('NoSQL worker timeout.');
					switch (item.type) {
						case 'find':
							item.builder && item.builder.$callback2(err, EMPTYARRAY, 0, EMPTYOBJECT);
							break;
						case 'count':
							item.builder && item.builder.$callback2(err, EMPTYOBJECT, 0, EMPTYOBJECT);
							break;
						case 'insert':
						case 'update':
						case 'remove':
							item.builder && item.builder.$callback(err, EMPTYOBJECT, EMPTYOBJECT);
							break;
						case 'clean':
						case 'clear':
							item.callback && item.callback(err);
							break;
						case 'stream':
							item.callback && item.callback(err, EMPTYOBJECT, 0);
							break;
						default:
							item.callback && item.callback(err, EMPTYOBJECT, EMPTYOBJECT);
							break;
					}
				}
			}
		}
	});

	FORKCALLBACKS = {};
	FORK = require('child_process').fork(module.filename.replace(/\.js$/, '') + 'worker.js', [], { cwd: F.directory });

	FORK.send({ TYPE: 'init', directory: F.path.root() });
	FORK.on('message', function(msg) {
		switch (msg.TYPE) {
			case 'find':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.builder.$callback2(msg.err, msg.response, msg.count, msg.repository);
				break;
			case 'count':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.builder.$callback2(msg.err, msg.response, msg.count, msg.repository);
				break;
			case 'insert':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.builder.$callback && obj.builder.$callback(msg.err, msg.response, msg.repository);
				break;
			case 'update':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.builder.$callback(msg.err, msg.response, msg.repository);
				break;
			case 'remove':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.builder.$callback(msg.err, msg.response, msg.repository);
				break;
			case 'backup':
			case 'restore':
			case 'counter.read':
			case 'counter.stats':
			case 'counter.clear':
			case 'storage.stats':
			case 'storage.clear':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.callback && obj.callback(msg.err, msg.response);
				break;
			case 'stream':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.callback && obj.callback(msg.err, msg.repository || {}, msg.count);
				break;
			case 'storage.scan':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.callback && obj.callback(msg.err, msg.response, msg.repository);
				break;
			case 'callback':
				var obj = FORKCALLBACKS[msg.id];
				obj && obj.callback && obj.callback(msg.err);
				break;

		}
		delete FORKCALLBACKS[msg.id];
	});

	var CMD = {};

	function send(instance, type) {
		var obj = {};
		obj.type = type;
		obj.name = instance.name;
		obj.time = Date.now();
		obj.t = instance instanceof Table;

		if (arguments.length > 2) {
			obj.arg = [];
			for (var i = 2; i < arguments.length; i++)
				obj.arg.push(arguments[i]);
		}
		setImmediate(send2, obj);
		return obj;
	}

	function notify(instance, type) {
		var obj = {};
		obj.type = type;
		obj.name = instance.name;
		obj.time = Date.now();
		obj.t = instance instanceof Table;

		if (arguments.length > 2) {
			obj.arg = [];
			for (var i = 2; i < arguments.length; i++)
				obj.arg.push(arguments[i]);
		}
		setImmediate(send2, obj, false);
		return obj;
	}

	function send2(obj, callback) {
		CMD.TYPE = obj.type;
		CMD.arg = obj.arg;
		CMD.data = obj.builder ? obj.builder.stringify() : null;
		CMD.name = obj.name;
		CMD.t = obj.t;
		if (callback !== false) {
			CMD.id = Math.random().toString(32).substring(2);
			FORKCALLBACKS[CMD.id] = obj;
		}
		FORK.send(CMD);
	}

	var DP = Database.prototype;
	var CP = Counter.prototype;
	var SP = Storage.prototype;

	TP.once = TP.on = TP.emit = TP.removeListener = TP.removeAllListeners = DP.once = DP.on = DP.emit = DP.removeListener = DP.removeAllListeners = CP.on = CP.once = CP.emit = CP.removeListener = CP.removeAllListeners = function() {
		PRINTLN('ERROR --> NoSQL events are not supported in fork mode.');
	};

	TP.listing = DP.listing = function(builder) {
		if (builder instanceof DatabaseBuilder)
			builder.db = this;
		else
			builder = new DatabaseBuilder(this);
		builder.$options.listing = true;
		builder.$take = builder.$options.take = 100;
		return send(this, 'find').builder = builder;
	};

	TP.find = DP.find = function(builder) {
		if (builder instanceof DatabaseBuilder)
			builder.db = this;
		else
			builder = new DatabaseBuilder(this);
		return send(this, 'find').builder = builder;
	};

	TP.find2 = DP.find2 = function(builder) {
		if (builder instanceof DatabaseBuilder)
			builder.db = this;
		else
			builder = new DatabaseBuilder(this);
		return send(this, 'find2').builder = builder;
	};

	TP.top = DP.top = function(max) {
		var builder = new DatabaseBuilder(this);
		builder.take(max);
		return send(this, 'find').builder = builder;
	};

	TP.one = DP.one = function() {
		var builder = new DatabaseBuilder(this);
		builder.first();
		return send(this, 'one').builder = builder;
	};

	TP.insert = DP.insert = function(doc, unique) {

		var self = this;
		var builder;

		if (unique) {
			builder = self.one();

			var callback;

			builder.callback(function(err, d) {
				if (d)
					callback && callback(null, 0);
				else {
					var tmp = self.insert(doc);
					tmp.callback(callback);
					tmp.$options.log = builder.$options.log;
				}
			});

			builder.callback = function(fn) {
				callback = fn;
				return builder;
			};

			return builder;
		}

		return send(self, 'insert', framework_builders.isSchema(doc) ? doc.$clean() : doc).builder = new DatabaseBuilder2(self);
	};

	TP.count = DP.count = function() {
		var builder = new DatabaseBuilder(this);
		return send(this, 'count').builder = builder;
	};

	DP.view = function() {
		throw new Error('NoSQL Views are not supported.');
	};

	TP.update = DP.update = function(doc, insert) {
		return send(this, 'update', framework_builders.isSchema(doc) ? doc.$clean() : doc, insert).builder = new DatabaseBuilder(this);
	};

	TP.modify = DP.modify = function(doc, insert) {
		return send(this, 'modify', framework_builders.isSchema(doc) ? doc.$clean() : doc, insert).builder = new DatabaseBuilder(this);
	};

	DP.restore = function(filename, callback) {
		var obj = send(this, 'restore', filename);
		obj.callback = callback;
		return this;
	};

	DP.backup = function(filename, callback) {
		var obj = send(this, 'backup', filename);
		obj.callback = callback;
		return this;
	};

	DP.refresh = function() {
		return this;
	};

	DP.drop = function() {
		notify(this, 'drop');
		return this;
	};

	TP.clear = DP.clear = function(callback) {
		send(this, 'clear').callback = callback;
		return this;
	};

	TP.clean = DP.clean = function(callback) {
		send(this, 'clean').callback = callback;
		return this;
	};

	TP.ready = DP.ready = function(callback) {
		callback && callback();
		return this;
	};

	TP.remove = DP.remove = function(filename) {
		return send(this, 'remove', filename).builder = new DatabaseBuilder(this);
	};

	TP.stream = DP.stream = function(fn, repository, callback) {

		if (typeof(repository) === 'function')  {
			callback = repository;
			repository = undefined;
		}

		send(this, 'stream', fn.toString(), repository).callback = callback;
		return this;
	};

	CP.min = function(id, count) {
		notify(this.db, 'counter.min', id, count);
		return this;
	};

	CP.max = function(id, count) {
		notify(this.db, 'counter.max', id, count);
		return this;
	};

	CP.sum = CP.inc = CP.hit = function(id, count) {
		notify(this.db, 'counter.hit', id, count);
		return this;
	};

	CP.remove = function(id) {
		notify(this.db, 'counter.remove', id);
		return this;
	};

	CP.read = function(options, callback) {
		send(this.db, 'counter.read', options).callback = callback;
		return this;
	};

	CP.stats = CP.stats_sum = function(top, year, month, day, type, callback) {

		if (typeof(day) == 'function') {
			callback = day;
			day = null;
		} else if (typeof(month) == 'function') {
			callback = month;
			month = null;
		} else if (typeof(year) === 'function') {
			callback = year;
			year = month = null;
		}

		send(this.db, 'counter.stats', top, year, month, day, type).callback = callback;
		return this;
	};

	CP.clear = function(callback) {
		send(this.db, 'counter.clear').callback = callback;
		return this;
	};

	SP.insert = function(doc) {
		notify(this.db, 'storage.insert', doc);
		return this;
	};

	SP.scan = function(beg, end, mapreduce, callback) {

		if (typeof(beg) === 'function') {
			mapreduce = beg;
			callback = end;
			beg = null;
			end = null;
		} else if (typeof(end) === 'function') {
			callback = mapreduce;
			mapreduce = end;
			end = null;
		}

		send(this.db, 'storage.scan', beg, end, mapreduce.toString()).callback = callback;
		return this;
	};

	SP.mapreduce = function(name, fn) {
		send(this.db, 'storage.mapreduce', name, fn);
		return this;
	};

	SP.stats = function(name, callback) {

		if (typeof(name) === 'function') {
			callback = name;
			name = undefined;
		}

		send(this.db, 'storage.stats', name).callback = callback;
		return this;
	};

	SP.clear = function(beg, end, callback) {

		if (typeof(beg) === 'function') {
			callback = end;
			beg = null;
			end = null;
		} else if (typeof(end) === 'function') {
			callback = end;
			end = null;
		}

		send(this.db, 'storage.clear', beg, end).callback = callback;
		return this;
	};
};

function Table(name, filename) {
	var t = this;
	t.filename = filename + EXTENSION_TABLE;
	t.filenameBackup = filename + EXTENSION_TABLE_BACKUP;
	t.filenameCounter = filename + EXTENSION_TABLE + EXTENSION_COUNTER;
	t.filenameMeta = filename + EXTENSION_TABLE + '-meta';
	t.directory = Path.dirname(filename);
	t.name = name;
	t.$name = '$' + name;
	t.pending_reader = [];
	t.pending_reader2 = [];
	t.pending_update = [];
	t.pending_append = [];
	t.pending_reader = [];
	t.pending_remove = [];
	t.pending_streamer = [];
	t.pending_clean = [];
	t.pending_clear = [];
	t.pending_locks = [];
	t.$events = {};

	t.step = 0;
	t.ready = false;
	t.$free = true;
	t.$writting = false;
	t.$reading = false;

	t.counter = new Counter(t);
	t.$meta();

	var schema = F.config['table.' + name];

	Fs.createReadStream(t.filename, { end: 1000 }).once('data', function(chunk) {

		if (schema) {
			t.parseSchema(schema.replace(/;|,/g, '|').trim().split('|'));
			schema = t.stringifySchema();
		}

		t.parseSchema(chunk.toString('utf8').split('\n', 1)[0].split('|'));

		t.ready = true;
		t.next(0);

		if (schema && t.stringifySchema() !== schema)
			t.extend(schema);

	}).on('error', function() {
		if (schema) {
			t.parseSchema(schema.replace(/;|,/g, '|').trim().split('|'));
			Fs.writeFileSync(t.filename, t.stringifySchema() + NEWLINE, 'utf8');
			t.ready = true;
			t.next(0);
		} else {
			t.readonly = true;
			t.pending_reader.length && (t.pending_reader = []);
			t.pending_update.length && (t.pending_update = []);
			t.pending_append.length && (t.pending_append = []);
			t.pending_reader.length && (t.pending_reader = []);
			t.pending_remove.length && (t.pending_remove = []);
			t.pending_streamer.length && (t.pending_streamer = []);
			t.pending_locks.length && (t.pending_locks = []);
			t.pending_clean.length && (t.pending_clean = []);
			t.pending_clear.length && (t.pending_clear = []);
			t.throwReadonly();
		}
	});
}

function Database(name, filename, readonly) {

	var self = this;
	var http = filename.substring(0, 6);
	self.readonly = http === 'http:/' || http === 'https:';
	self.filename = self.readonly ? filename.format('') : filename + EXTENSION;
	self.directory = Path.dirname(filename);

	if (!readonly) {
		self.filenameCounter = self.readonly ? filename.format('counter', '-') : filename + EXTENSION + EXTENSION_COUNTER;
		self.filenameLog = self.readonly || readonly === true ? '' : filename + EXTENSION_LOG;
		self.filenameBackup = self.readonly || readonly === true ? '' : filename + EXTENSION_BACKUP;
		self.filenameStorage = self.readonly || readonly === true ? '' : filename + '-storage/{0}' + EXTENSION;
		self.filenameMeta = filename + EXTENSION_META;
		self.filenameBackup2 = framework_utils.join(self.directory, name + '_backup' + EXTENSION);
		self.inmemory = {};
		self.inmemorylastusage;
		// self.metadata;
		self.$meta();
	}

	self.filenameTemp = filename + EXTENSION_TMP;
	self.name = name;
	self.pending_update = [];
	self.pending_append = [];
	self.pending_reader = [];
	self.pending_remove = [];
	self.pending_reader2 = [];
	self.pending_streamer = [];
	self.pending_clean = [];
	self.pending_clear = [];
	self.pending_locks = [];
	self.step = 0;
	self.pending_drops = false;
	self.pending_reindex = false;
	self.binary = self.readonly || readonly === true ? null : new Binary(self, self.directory + '/' + self.name + '-binary/');
	self.storage = self.readonly || readonly === true ? null : new Storage(self, self.directory + '/' + self.name + '-storage/');
	self.counter = readonly === true ? null : new Counter(self);
	self.$timeoutmeta;
	self.$events = {};
	self.$free = true;
	self.$writting = false;
	self.$reading = false;
}

const TP = Table.prototype;
const DP = Database.prototype;

TP.view = DP.view = function(name) {
	throw new Error('NoSQL Views are not supported in this version.');
};

TP.emit = DP.emit = function(name, a, b, c, d, e, f, g) {
	var evt = this.$events[name];
	if (evt) {
		var clean = false;
		for (var i = 0, length = evt.length; i < length; i++) {
			if (evt[i].$once)
				clean = true;
			evt[i].call(this, a, b, c, d, e, f, g);
		}
		if (clean) {
			evt = evt.remove(n => n.$once);
			if (evt.length)
				this.$events[name] = evt;
			else
				this.$events[name] = undefined;
		}
	}
	return this;
};

TP.on = DP.on = function(name, fn) {

	if (!fn.$once)
		this.$free = false;

	if (this.$events[name])
		this.$events[name].push(fn);
	else
		this.$events[name] = [fn];
	return this;
};

TP.once = DP.once = function(name, fn) {
	fn.$once = true;
	return this.on(name, fn);
};

TP.removeListener = DP.removeListener = function(name, fn) {
	var evt = this.$events[name];
	if (evt) {
		evt = evt.remove(n => n === fn);
		if (evt.length)
			this.$events[name] = evt;
		else
			this.$events[name] = undefined;
	}
	return this;
};

TP.removeAllListeners = DP.removeAllListeners = function(name) {
	if (name === true)
		this.$events = EMPTYOBJECT;
	else if (name)
		this.$events[name] = undefined;
	else
		this.$events[name] = {};
	return this;
};

exports.Database = Database;
exports.DatabaseBuilder = DatabaseBuilder;
exports.DatabaseBuilder2 = DatabaseBuilder2;
exports.DatabaseCounter = Counter;
exports.DatabaseBinary = Binary;
exports.DatabaseStorage = Storage;
exports.DatabaseTable = Table;

exports.load = function(name, filename) {
	return new Database(name, filename);
};

exports.table = function(name, filename) {
	return new Table(name, filename);
};

exports.memory = exports.inmemory = function(name) {
	return INMEMORY[name] = true;
};

TP.get = DP.get = function(name) {
	return this.meta(name);
};

TP.set = DP.set = function(name, value) {
	return this.meta(name, value);
};

TP.meta = DP.meta = function(name, value) {
	var self = this;
	if (value === undefined)
		return self.metadata ? self.metadata[name] : undefined;
	if (!self.metadata)
		self.metadata = {};
	self.metadata[name] = value;
	clearTimeout(self.timeoutmeta);
	self.timeoutmeta = setTimeout(() => self.$meta(true), 500);
	return self;
};

TP.backups = DP.backups = function(filter, callback) {

	if (callback === undefined) {
		callback = filter;
		filter = null;
	}

	var self = this;
	var isTable = self instanceof Table;

	if (isTable && !self.ready) {
		setTimeout((self, filter, callback) => self.backups(filter, callback), 500, self, filter, callback);
		return self;
	}

	var stream = Fs.createReadStream(self.filenameBackup);
	var output = [];
	var tmp = {};

	tmp.keys = self.$keys;

	stream.on('data', U.streamer(NEWLINEBUF, function(item, index) {
		var end = item.indexOf('|', item.indexOf('|') + 2);
		var meta = item.substring(0, end);
		var arr = meta.split('|');
		var dv = arr[0].trim().replace(' ', 'T') + ':00.000Z';
		tmp.line = item.substring(end + 1).trim();
		if (isTable)
			tmp.line = tmp.line.split('|');
		var obj = { id: index + 1, date: dv.parseDate(), user: arr[1].trim(), data: self instanceof Table ? self.parseData(tmp) : tmp.line.parseJSON(true) };
		if (!filter || filter(obj))
			output.push(obj);
	}), stream);

	CLEANUP(stream, () => callback(null, output));

	return self;
};

function next_operation(self, type) {
	self.next(type);
}

DP.ready = function(fn) {
	var self = this;
	fn.call(self);
	return self;
};

DP.insert = function(doc, unique) {

	var self = this;
	var builder;

	self.readonly && self.throwReadonly();

	if (unique) {
		builder = self.one();
		var callback;

		builder.callback(function(err, d) {
			if (d)
				callback && callback(null, 0);
			else
				self.insert(doc).callback(callback);
		});

		builder.callback = function(fn) {
			callback = fn;
			return builder;
		};

		return builder;
	}

	builder = new DatabaseBuilder2(self);
	var json = framework_builders.isSchema(doc) ? doc.$clean() : doc;
	self.pending_append.push({ doc: JSON.stringify(json).replace(REGBOOL, JSONBOOL), raw: doc, builder: builder });
	setImmediate(next_operation, self, 1);
	self.$events.insert && self.emit('insert', json);
	return builder;
};

DP.upsert = function(doc) {
	return this.insert(doc, true);
};

DP.update = function(doc, insert) {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	var data = framework_builders.isSchema(doc) ? doc.$clean() : doc;
	self.pending_update.push({ builder: builder, doc: data, count: 0, insert: insert === true ? data : insert });
	setImmediate(next_operation, self, 2);
	return builder;
};

DP.modify = function(doc, insert) {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	var data = framework_builders.isSchema(doc) ? doc.$clean() : doc;
	var keys = Object.keys(data);

	if (keys.length) {
		var inc = null;
		for (var i = 0; i < keys.length; i++) {
			var key = keys[i];
			switch (key[0]) {
				case '+':
				case '-':
				case '*':
				case '/':
					!inc && (inc = {});
					var tmp = key.substring(1);
					inc[tmp] = key[0];
					doc[tmp] = doc[key];
					doc[key] = undefined;
					keys[i] = tmp;
					break;
			}
		}
		self.pending_update.push({ builder: builder, doc: data, count: 0, keys: keys, inc: inc, insert: insert === true ? data : insert });
		setImmediate(next_operation, self, 2);
	}

	return builder;
};

DP.restore = function(filename, callback) {
	var self = this;
	self.readonly && self.throwReadonly();
	U.wait(() => !self.type, function(err) {

		if (err)
			throw new Error('Database can\'t be restored because it\'s busy.');

		self.type = 9;

		F.restore(filename, F.path.root(), function(err, response) {
			self.type = 0;
			if (!err) {
				self.$meta();
				self.binary.$refresh();
				self.refresh();
				self.storage && self.storage.refresh();
			}
			self.$events.change && self.emit('change', 'restore');
			callback && callback(err, response);
		});

	});
	return self;
};

DP.backup = function(filename, callback) {

	var self = this;
	self.readonly && self.throwReadonly();

	var list = [];
	var pending = [];

	pending.push(function(next) {
		F.path.exists(self.filename, function(e) {
			e && list.push(Path.join(F.config['directory-databases'], self.name + EXTENSION));
			next();
		});
	});

	pending.push(function(next) {
		F.path.exists(F.path.databases(self.name + EXTENSION_META), function(e) {
			e && list.push(Path.join(F.config['directory-databases'], self.name + EXTENSION_META));
			next();
		});
	});

	pending.push(function(next) {
		F.path.exists(self.filenameBackup, function(e) {
			e && list.push(Path.join(F.config['directory-databases'], self.name + EXTENSION_BACKUP));
			next();
		});
	});

	pending.push(function(next) {
		F.path.exists(self.filenameCounter, function(e) {
			e && list.push(Path.join(F.config['directory-databases'], self.name + EXTENSION + EXTENSION_COUNTER));
			next();
		});
	});

	pending.push(function(next) {
		F.path.exists(self.filenameLog, function(e) {
			e && list.push(Path.join(F.config['directory-databases'], self.name + EXTENSION_LOG));
			next();
		});
	});

	pending.push(function(next) {
		F.path.exists(F.path.databases(self.name + '-binary'), function(e, size, file) {
			e && !file && list.push(Path.join(F.config['directory-databases'], self.name + '-binary'));
			next();
		});
	});

	pending.push(function(next) {
		F.path.exists(F.path.databases(self.name + '-storage'), function(e, size, file) {
			e && !file && list.push(Path.join(F.config['directory-databases'], self.name + '-storage'));
			next();
		});
	});

	pending.push(function(next) {
		var filename = Path.join(F.config['directory-databases'], self.name + EXTENSION_MAPREDUCE);
		F.path.exists(F.path.root(filename), function(e) {
			e && list.push(filename);
			next();
		});
	});

	pending.async(function() {
		if (list.length)
			F.backup(filename, list, callback);
		else
			callback(new Error('No files for backuping.'));
	});

	return self;
};

DP.backup2 = function(filename, remove) {

	if (typeof(filename) === 'boolean') {
		remove = filename;
		filename = '';
	}

	var self = this;
	self.readonly && self.throwReadonly();

	if (remove)
		return self.remove(filename || '');

	var builder = new DatabaseBuilder2(self);
	var stream = Fs.createReadStream(self.filename);

	stream.pipe(Fs.createWriteStream(filename || self.filenameBackup2));

	stream.on('error', function(err) {
		builder.$options.log && builder.log();
		builder.$callback && builder.$callback(errorhandling(err, builder));
		builder.$callback = null;
	});

	stream.on('end', function() {
		builder.$options.log && builder.log();
		builder.$callback && builder.$callback(errorhandling(null, builder, true), true);
		builder.$callback = null;
	});

	return builder;
};

DP.drop = function() {
	var self = this;
	self.readonly && self.throwReadonly();
	self.pending_drops = true;
	setImmediate(next_operation, self, 7);
	return self;
};

DP.free = function(force) {
	var self = this;
	if (!force && !self.$free)
		return self;
	self.counter.removeAllListeners(true);
	self.binary.removeAllListeners(true);
	self.removeAllListeners(true);
	self.binary = null;
	self.counter = null;
	delete F.databases[self.name];
	return self;
};

DP.release = function() {
	var self = this;
	self.inmemory = {};
	self.inmemorylastusage = undefined;
	return self;
};

TP.clear = DP.clear = function(callback) {
	var self = this;
	self.readonly && self.throwReadonly();
	self.pending_clear.push(callback || NOOP);
	setImmediate(next_operation, self, 12);
	return self;
};

TP.clean = DP.clean = function(callback) {
	var self = this;
	self.readonly && self.throwReadonly();
	self.pending_clean.push(callback || NOOP);
	setImmediate(next_operation, self, 13);
	return self;
};

TP.lock = DP.lock = function(callback) {
	var self = this;
	self.readonly && self.throwReadonly();
	self.pending_locks.push(callback || NOOP);
	setImmediate(next_operation, self, 14);
	return self;
};

DP.remove = function(filename) {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	var backup = filename === undefined ? undefined : filename || self.filenameBackup2;

	if (backup)
		backup = new Backuper(backup);

	self.pending_remove.push({ builder: builder, count: 0, backup: backup });
	setImmediate(next_operation, self, 3);
	return builder;
};

DP.listing = function(builder) {
	var self = this;
	if (builder)
		builder.db = self;
	else
		builder = new DatabaseBuilder(self);
	builder.$options.listing = true;
	builder.$take = builder.$options.take = 100;
	self.pending_reader.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

DP.find = function(builder) {
	var self = this;
	if (builder instanceof DatabaseBuilder)
		builder.db = self;
	else
		builder = new DatabaseBuilder(self);
	self.pending_reader.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

DP.find2 = function(builder) {
	var self = this;
	if (builder instanceof DatabaseBuilder)
		builder.db = self;
	else
		builder = new DatabaseBuilder(self);
	if (self.readonly)
		return self.find(builder);
	self.pending_reader2.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 11);
	return builder;
};

DP.stream = function(fn, repository, callback) {
	var self = this;

	if (typeof(repository) === 'function') {
		callback = repository;
		repository = null;
	}

	self.pending_streamer.push({ fn: fn, callback: callback, repository: repository || {} });
	setImmediate(next_operation, self, 10);
	return self;
};

DP.throwReadonly = function() {
	throw new Error('Database "{0}" is readonly.'.format(this.name));
};

DP.scalar = function(type, field) {
	return this.find().scalar(type, field);
};

DP.count = function() {
	var self = this;
	var builder = new DatabaseBuilder(self);
	self.pending_reader.push({ builder: builder, count: 0, type: 1 });
	setImmediate(next_operation, self, 4);
	return builder;
};

DP.one = function() {
	var self = this;
	var builder = new DatabaseBuilder(self);
	builder.first();
	self.pending_reader.push({ builder: builder, count: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

DP.top = function(max) {
	var self = this;
	var builder = new DatabaseBuilder(self);
	builder.take(max);
	self.pending_reader.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

//  1 append
//  2 update
//  3 remove
//  4 reader
//  5 views
//  6 reader views
//  7 drop
//  8 backup
//  9 restore
// 10 streamer
// 11 reader reverse
// 12 clear
// 13 clean
// 14 locks

const NEXTWAIT = { 7: true, 8: true, 9: true, 12: true, 13: true, 14: true };

DP.next = function(type) {

	if (type && NEXTWAIT[this.step])
		return;

	if (!this.$writting && !this.$reading) {

		if (this.step !== 12 && this.pending_clear.length) {
			if (INMEMORY[this.name])
				this.$clear_inmemory();
			else
				this.$clear();
			return;
		}

		if (this.step !== 13 && this.pending_clean.length) {
			this.$clean();
			return;
		}

		if (this.step !== 7 && !this.pending_reindex && this.pending_drops) {
			this.$drop();
			return;
		}

		if (this.step !== 14 && this.pending_locks.length) {
			this.$lock();
			return;
		}
	}

	if (!this.$writting) {

		if (this.step !== 1 && !this.pending_reindex && this.pending_append.length) {
			if (INMEMORY[this.name])
				this.$append_inmemory();
			else
				this.$append();
			return;
		}

		if (this.step !== 2 && !this.$writting && this.pending_update.length) {
			if (INMEMORY[this.name])
				this.$update_inmemory();
			else
				this.$update();
			return;
		}

		if (this.step !== 3 && !this.$writting && this.pending_remove.length) {
			if (INMEMORY[this.name])
				this.$remove_inmemory();
			else
				this.$remove();
			return;
		}

	}

	if (!this.$reading) {

		if (this.step !== 4 && this.pending_reader.length) {
			this.$reader();
			return;
		}

		if (this.step !== 11 && this.pending_reader2.length) {
			this.$reader3();
			return;
		}

		if (this.step !== 10 && this.pending_streamer.length) {
			this.$streamer();
			return;
		}
	}

	if (this.step !== type) {
		this.step = 0;
		setImmediate(next_operation, this, 0);
	}
};

// ======================================================================
// FILE OPERATIONS
// ======================================================================

// InMemory saving
DP.$save = function() {
	var self = this;
	setTimeout2('nosql.' + self.name, function() {
		var data = self.inmemory['#'] || EMPTYARRAY;
		var builder = [];
		for (var i = 0, length = data.length; i < length; i++)
			builder.push(JSON.stringify(data[i]).replace(REGBOOL, JSONBOOL));
		Fs.writeFile(self.filename, builder.join(NEWLINE) + NEWLINE, F.errorcallback);
	}, 50, 100);
	return self;
};

DP.$inmemory = function(callback) {

	var self = this;
	var view = '#';

	self.readonly && self.throwReadonly();

	// Last usage
	self.inmemorylastusage = global.F ? global.NOW : undefined;

	if (self.inmemory[view])
		return callback();

	var filename = self.filename;
	if (view !== '#')
		filename = filename.replace(/\.nosql/, '#' + view + '.nosql');

	self.inmemory[view] = [];

	Fs.readFile(filename, function(err, data) {
		if (err)
			return callback();
		var arr = data.toString('utf8').split('\n');
		for (var i = 0, length = arr.length; i < length; i++) {
			var item = arr[i];
			if (!item)
				continue;
			try {
				item = JSON.parse(item.trim(), jsonparser);
				item && self.inmemory[view].push(item);
			} catch (e) {}
		}

		callback();
	});

	return self;
};

TP.$meta = DP.$meta = function(write) {

	var self = this;

	if (write) {
		self.readonly && self.throwReadonly();
		Fs.writeFile(self.filenameMeta, JSON.stringify(self.metadata), F.errorcallback);
		return self;
	}

	if (self.readonly)
		return self;

	try {
		self.metadata = JSON.parse(Fs.readFileSync(self.filenameMeta).toString('utf8'), jsonparser);
	} catch (err) {}

	return self;
};

DP.$append = function() {
	var self = this;
	self.step = 1;

	if (!self.pending_append.length) {
		self.next(0);
		return;
	}

	self.$writting = true;

	self.pending_append.splice(0).limit(JSONBUFFER, function(items, next) {

		var json = '';
		for (var i = 0, length = items.length; i < length; i++) {
			json += items[i].doc + NEWLINE;
		}

		Fs.appendFile(self.filename, json, function(err) {

			err && F.error(err, 'NoSQL insert: ' + self.name);

			for (var i = 0, length = items.length; i < length; i++) {
				items[i].builder.$options.log && items[i].builder.log();
				var callback = items[i].builder.$callback;
				callback && callback(err, 1);
			}

			next();
		});

	}, () => setImmediate(next_append, self));
};

function next_append(self) {
	self.$writting = false;
	self.next(0);
	self.$events.change && self.emit('change', 'insert');
}

DP.$append_inmemory = function() {
	var self = this;
	self.step = 1;

	if (!self.pending_append.length) {
		self.next(0);
		return self;
	}

	var items = self.pending_append.splice(0);

	return self.$inmemory(function() {

		for (var i = 0, length = items.length; i < length; i++) {
			self.inmemory['#'].push(JSON.parse(items[i].doc, jsonparser));
			items[i].builder.$options.log && items[i].builder.log();
			var callback = items[i].builder.$callback;
			callback && callback(null, 1);
		}

		self.$save();
		setImmediate(next_append, self);
	});
};

DP.$update = function() {

	var self = this;
	self.step = 2;

	if (!self.pending_update.length) {
		self.next(0);
		return self;
	}

	self.$writting = true;

	var filter = self.pending_update.splice(0);
	var length = filter.length;
	var backup = false;
	var filters = 0;
	var change = false;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
		if (fil.backup || fil.builder.$options.backup)
			backup = true;
	}

	var indexer = 0;
	var fs = new NoSQLStream(self.filename);

	fs.ondocuments = function() {

		var docs = JSON.parse('[' + fs.docs + ']', jsonparser);

		for (var a = 0; a < docs.length; a++) {

			indexer++;

			var doc = docs[a];
			var is = false;
			var rec = fs.docsbuffer[a];

			for (var i = 0; i < length; i++) {

				var item = filter[i];
				if (item.skip)
					continue;

				item.filter.index = indexer;

				var output = item.compare(doc, item.filter, indexer);
				if (output) {

					var e = item.keys ? 'modify' : 'update';
					var old = self.$events[e] ? CLONE(output) : 0;

					if (item.filter.options.first) {
						item.skip = true;
						filters++;
					}

					if (item.keys) {
						for (var j = 0; j < item.keys.length; j++) {
							var key = item.keys[j];
							var val = item.doc[key];
							if (val !== undefined) {
								if (typeof(val) === 'function')
									output[key] = val(output[key], output);
								else if (item.inc && item.inc[key]) {
									switch (item.inc[key]) {
										case '+':
											output[key] = (output[key] || 0) + val;
											break;
										case '-':
											output[key] = (output[key] || 0) - val;
											break;
										case '*':
											output[key] = (output[key] || 0) + val;
											break;
										case '/':
											output[key] = (output[key] || 0) / val;
											break;
									}
								} else
									output[key] = val;
							}
						}
					} else
						output = typeof(item.doc) === 'function' ? item.doc(output) : item.doc;

					self.$events[e] && self.emit(e, output, old);
					item.count++;
					doc = output;
					is = true;
				}
			}

			if (is) {

				if (backup) {
					for (var i = 0; i < length; i++) {
						var item = filter[i];
						item.backup && item.backup.write(rec.doc + NEWLINE);
						item.builder.$options.backup && item.builder.$backupdoc(rec.doc);
					}
				}

				var upd = JSON.stringify(doc).replace(REGBOOL, JSONBOOL);
				if (upd === rec.doc)
					continue;

				var was = true;

				if (!change)
					change = true;

				if (rec.doc.length === upd.length) {
					var b = Buffer.byteLength(upd);
					if (rec.length === b) {
						fs.write(upd + NEWLINE, rec.position);
						was = false;
					}
				}

				if (was) {
					var tmp = '-' + rec.doc.substring(1) + NEWLINE;
					fs.write(tmp, rec.position);
					fs.write2(upd + NEWLINE);
				}
			}

			if (filters === length)
				return false;
		}
	};

	fs.$callback = function() {
		for (var i = 0; i < length; i++) {
			var item = filter[i];
			if (item.insert && !item.count) {
				item.builder.$insertcallback && item.builder.$insertcallback(item.insert);
				var tmp = self.insert(item.insert);
				tmp.$callback = item.builder.$callback;
				tmp.$options.log = item.builder.$options.log;
			} else {
				item.builder.$options.log && item.builder.log();
				item.builder.$callback && item.builder.$callback(errorhandling(null, item.builder, item.count), item.count, item.filter.repository);
			}
		}

		fs = null;
		self.$writting = false;
		self.next(0);
		change && self.$events.change && self.emit('change', 'update');
	};

	fs.openupdate();
	return self;
};

DP.$update_inmemory = function() {

	var self = this;
	self.step = 2;

	if (!self.pending_update.length) {
		self.next(0);
		return self;
	}

	var filter = self.pending_update.splice(0);
	var length = filter.length;
	var change = false;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
	}

	return self.$inmemory(function() {

		var data = self.inmemory['#'];

		for (var a = 0, al = data.length; a < al; a++) {

			var doc = data[a];

			for (var i = 0; i < length; i++) {

				var item = filter[i];
				var builder = item.builder;
				item.filter.index = j;
				var output = item.compare(doc, item.filter, j);
				if (output) {

					var e = item.keys ? 'modify' : 'update';
					var old = self.$events[e] ? CLONE(output) : 0;

					builder.$options.backup && builder.$backupdoc(doc);

					if (item.keys) {
						for (var j = 0, jl = item.keys.length; j < jl; j++) {
							var val = item.doc[item.keys[j]];
							if (val !== undefined) {
								if (typeof(val) === 'function')
									doc[item.keys[j]] = val(doc[item.keys[j]], doc);
								else
									doc[item.keys[j]] = val;
							}
						}
					} else
						doc = typeof(item.doc) === 'function' ? item.doc(doc) : item.doc;

					self.$events[e] && self.emit(e, doc, old);
					item.count++;
					if (!change)
						change = true;
				}
			}
		}

		self.$save();

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			if (item.insert && !item.count) {
				item.builder.$insertcallback && item.builder.$insertcallback(item.insert);
				var tmp = self.insert(item.insert);
				tmp.$callback = item.builder.$callback;
				tmp.$options.log = item.builder.$options.log;
			} else {
				var e = item.keys ? 'modify' : 'update';
				item.count && self.$events[e] && self.emit(e, item.doc);
				item.builder.$options.log && item.builder.log();
				item.builder.$callback && item.builder.$callback(errorhandling(null, item.builder, item.count), item.count, item.filter.repository);
			}
		}

		setImmediate(function() {
			self.next(0);
			change && self.$events.change && self.emit('change', 'update');
		});
	});
};

DP.$reader = function() {

	var self = this;
	self.step = 4;

	if (!self.pending_reader.length) {
		self.next(0);
		return self;
	}

	var list = self.pending_reader.splice(0);
	if (INMEMORY[self.name]) {
		self.$reader2_inmemory(list, () => self.next(0));
	} else {
		self.$reading = true;
		self.$reader2(self.filename, list, function() {
			self.$reading = false;
			self.next(0);
		});
	}

	return self;
};

function listing(builder, item) {
	var skip = builder.$options.skip || 0;
	var take = builder.$options.take || 0;
	return { page: ((skip / take) + 1), pages: item.count ? Math.ceil(item.count / take) : 0, limit: take, count: item.count, items: item.response || [] };
}

DP.$reader2 = function(filename, items, callback, reader) {

	var self = this;

	if (self.readonly) {
		if (reader === undefined) {
			U.download(filename, FLAGS_READ, function(err, response) {
				err && F.error(err, 'NoSQL database download: ' + self.name);
				self.$reader2(filename, items, callback, err ? null : response);
			});
			return self;
		}
	}

	var filter = items;
	var length = filter.length;
	var first = true;
	var indexer = 0;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		if (!fil.builder.$options.first || fil.builder.$options.sort)
			first = false;
		fil.scalarcount = 0;
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
	}

	if (first && length > 1)
		first = false;

	var fs = new NoSQLStream(self.filename);

	fs.ondocuments = function() {

		var docs = JSON.parse('[' + fs.docs + ']', jsonparser);
		var val;

		for (var j = 0; j < docs.length; j++) {
			var json = docs[j];
			indexer++;
			for (var i = 0; i < length; i++) {
				var item = filter[i];
				var builder = item.builder;
				item.filter.index = indexer;
				var output = item.compare(json, item.filter, indexer);
				if (!output)
					continue;

				item.count++;

				if (!builder.$inlinesort && ((builder.$options.skip && builder.$options.skip >= item.count) || (builder.$options.take && builder.$options.take <= item.counter)))
					continue;

				item.counter++;

				if (item.type)
					continue;

				switch (builder.$options.scalar) {
					case 'count':
						item.scalar = item.scalar ? item.scalar + 1 : 1;
						break;
					case 'sum':
						val = output[builder.$options.scalarfield] || 0;
						item.scalar = item.scalar ? item.scalar + val : val;
						break;
					case 'min':
						val = output[builder.$options.scalarfield] || 0;
						if (val != null) {
							if (item.scalar) {
								if (item.scalar > val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'max':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar) {
								if (item.scalar < val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'avg':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							item.scalar = item.scalar ? item.scalar + val : val;
							item.scalarcount++;
						}
						break;
					case 'group':
						!item.scalar && (item.scalar = {});
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar[val])
								item.scalar[val]++;
							else
								item.scalar[val] = 1;
						}
						break;
					default:
						if (builder.$inlinesort)
							nosqlinlinesorter(item, builder, output);
						else if (item.response)
							item.response.push(output);
						else
							item.response = [output];
						break;
				}

				if (first)
					return false;
			}
		}
	};

	fs.$callback = function() {

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			var builder = item.builder;
			var output;

			if (builder.$options.scalar || !builder.$options.sort) {

				if (builder.$options.scalar)
					output = builder.$options.scalar === 'avg' ? item.scalar / item.scalarcount : item.scalar;
				else if (builder.$options.first)
					output = item.response ? item.response[0] : undefined;
				else if (builder.$options.listing)
					output = listing(builder, item);
				else
					output = item.response || [];

				builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
				continue;
			}

			if (item.count) {
				if (builder.$options.sort.name) {
					if (!builder.$inlinesort || builder.$options.take !== item.response.length)
						item.response.quicksort(builder.$options.sort.name, builder.$options.sort.asc);
				} else if (builder.$options.sort === null)
					item.response.random();
				else
					item.response.sort(builder.$options.sort);

				if (builder.$options.skip && builder.$options.take)
					item.response = item.response.splice(builder.$options.skip, builder.$options.take);
				else if (builder.$options.skip)
					item.response = item.response.splice(builder.$options.skip);
				else if (!builder.$inlinesort && builder.$options.take)
					item.response = item.response.splice(0, builder.$options.take);
			}

			if (builder.$options.first)
				output = item.response ? item.response[0] : undefined;
			else {
				if (builder.$options.listing)
					output = listing(builder, item);
				else
					output = item.response || [];
			}

			builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
			builder.done();
		}

		fs = null;
		callback();
	};

	if (reader)
		fs.openstream(reader);
	else
		fs.openread();

	return self;
};

DP.$reader3 = function() {

	var self = this;

	self.step = 11;

	if (!self.pending_reader2.length) {
		self.next(0);
		return self;
	}

	self.$reading = true;

	var filter = self.pending_reader2.splice(0);
	var length = filter.length;
	var first = true;
	var indexer = 0;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		if (!fil.builder.$options.first)
			first = false;
		fil.scalarcount = 0;
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
	}

	if (first && length > 1)
		first = false;

	var fs = new NoSQLStream(self.filename);

	fs.ondocuments = function() {

		var docs = JSON.parse('[' + fs.docs + ']', jsonparser);
		var val;

		for (var j = 0; j < docs.length; j++) {
			var json = docs[j];
			indexer++;

			var done = true;

			for (var i = 0; i < length; i++) {

				var item = filter[i];

				if (item.done)
					continue;
				else if (done)
					done = false;

				var builder = item.builder;
				item.filter.index = indexer;

				var output = item.compare(json, item.filter, indexer);
				if (!output)
					continue;

				item.count++;

				if (!builder.$inlinesort && ((builder.$options.skip && builder.$options.skip >= item.count) || (builder.$options.take && builder.$options.take <= item.counter)))
					continue;

				item.counter++;

				if (!builder.$inlinesort && !item.done)
					item.done = builder.$options.take && builder.$options.take <= item.counter;

				if (item.type)
					continue;

				switch (builder.$options.scalar) {
					case 'count':
						item.scalar = item.scalar ? item.scalar + 1 : 1;
						break;
					case 'sum':
						val = output[builder.$options.scalarfield] || 0;
						item.scalar = item.scalar ? item.scalar + val : val;
						break;
					case 'min':
						val = output[builder.$options.scalarfield] || 0;
						if (val != null) {
							if (item.scalar) {
								if (item.scalar > val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'max':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar) {
								if (item.scalar < val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'avg':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							item.scalar = item.scalar ? item.scalar + val : val;
							item.scalarcount++;
						}
						break;
					case 'group':
						!item.scalar && (item.scalar = {});
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar[val])
								item.scalar[val]++;
							else
								item.scalar[val] = 1;
						}
						break;
					default:
						if (builder.$inlinesort)
							nosqlinlinesorter(item, builder, output);
						else if (item.response)
							item.response.push(output);
						else
							item.response = [output];
						break;
				}

				if (first)
					return false;
			}

			if (done)
				return false;
		}
	};

	fs.$callback = function() {

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			var builder = item.builder;
			var output;

			if (builder.$options.scalar || !builder.$options.sort) {

				if (builder.$options.scalar)
					output = builder.$options.scalar === 'avg' ? item.scalar / item.scalarcount : item.scalar;
				else if (builder.$options.first)
					output = item.response ? item.response[0] : undefined;
				else if (builder.$options.listing)
					output = listing(builder, item);
				else
					output = item.response || [];

				builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
				continue;
			}

			if (item.count) {
				if (builder.$options.sort.name) {
					if (!builder.$inlinesort || builder.$options.take !== item.response.length)
						item.response.quicksort(builder.$options.sort.name, builder.$options.sort.asc);
				} else if (builder.$options.sort === null)
					item.response.random();
				else
					item.response.sort(builder.$options.sort);

				if (builder.$options.skip && builder.$options.take)
					item.response = item.response.splice(builder.$options.skip, builder.$options.take);
				else if (builder.$options.skip)
					item.response = item.response.splice(builder.$options.skip);
				else if (!builder.$inlinesort && builder.$options.take)
					item.response = item.response.splice(0, builder.$options.take);
			}

			if (builder.$options.first)
				output = item.response ? item.response[0] : undefined;
			else if (builder.$options.listing)
				output = listing(builder, item);
			else
				output = item.response || [];

			builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
			builder.done();
		}

		self.$reading = false;
		fs = null;
		self.next(0);
	};

	fs.openreadreverse();
	return self;
};

DP.$streamer = function() {

	var self = this;
	self.step = 10;

	if (!self.pending_streamer.length) {
		self.next(0);
		return self;
	}

	self.$reading = true;

	var filter = self.pending_streamer.splice(0);
	var length = filter.length;
	var count = 0;
	var fs = new NoSQLStream(self.filename);

	fs.ondocuments = function() {
		var docs = JSON.parse('[' + fs.docs + ']', jsonparser);
		for (var j = 0; j < docs.length; j++) {
			var json = docs[j];
			count++;
			for (var i = 0; i < length; i++)
				filter[i].fn(json, filter[i].repository, count);
		}
	};

	fs.$callback = function() {
		for (var i = 0; i < length; i++)
			filter[i].callback && filter[i].callback(null, filter[i].repository, count);
		self.$reading = false;
		self.next(0);
		fs = null;
	};

	fs.openread();
	return self;
};

function nosqlinlinesorter(item, builder, doc) {

	if (!item.response) {
		item.response = [doc];
		return;
	}

	var length = item.response.length;
	if (length < builder.$limit) {
		item.response.push(doc);
		length + 1 >= builder.$limit && item.response.quicksort(builder.$options.sort.name, builder.$options.sort.asc);
	} else
		nosqlresort(item.response, builder, doc);
}

function nosqlsortvalue(a, b, sorter) {
	var type = typeof(a);
	if (type === 'number')
		return sorter.asc ? a > b : a < b;
	else if (type === 'string') {
		var c = COMPARER(a, b);
		return sorter.asc ? c === 1 : c === -1;
	} else if (type === 'boolean')
		// return sorter.asc ? a > b : a < b;
		return sorter.asc ? (a && !b) : (!a && b);
	else if (a instanceof Date)
		return sorter.asc ? a > b : a < b;
	return false;
}

function nosqlresort(arr, builder, doc) {
	var b = doc[builder.$options.sort.name];
	var beg = 0;
	var length = arr.length;
	var tmp = length - 1;

	var sort = nosqlsortvalue(arr[tmp][builder.$options.sort.name], b, builder.$options.sort);
	if (!sort)
		return;

	tmp = arr.length / 2 >> 0;
	sort = nosqlsortvalue(arr[tmp][builder.$options.sort.name], b, builder.$options.sort);
	if (!sort)
		beg = tmp + 1;

	for (var i = beg; i < length; i++) {
		var item = arr[i];
		var sort = nosqlsortvalue(item[builder.$options.sort.name], b, builder.$options.sort);
		if (!sort)
			continue;
		for (var j = length - 1; j > i; j--)
			arr[j] = arr[j - 1];
		arr[i] = doc;
		return;
	}
}

DP.$reader2_inmemory = function(items, callback) {

	var self = this;
	var filter = items;
	var length = filter.length;
	var name = '#';

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
	}

	return self.$inmemory(function() {

		var data = self.inmemory[name];
		var val;

		for (var j = 0, jl = data.length; j < jl; j++) {
			var json = data[j];
			for (var i = 0; i < length; i++) {
				var item = filter[i];
				var builder = item.builder;
				item.filter.index = j;
				var output = item.compare(U.clone(json), item.filter, j);
				if (!output)
					continue;

				item.count++;

				if (!builder.$options.sort && ((builder.$options.skip && builder.$options.skip >= item.count) || (builder.$options.take && builder.$options.take <= item.counter)))
					continue;

				item.counter++;

				if (item.type)
					continue;

				switch (builder.$options.scalar) {
					case 'count':
						item.scalar = item.scalar ? item.scalar + 1 : 1;
						break;
					case 'sum':
						val = json[builder.$options.scalarfield] || 0;
						item.scalar = item.scalar ? item.scalar + val : val;
						break;
					case 'min':
						val = json[builder.$options.scalarfield] || 0;
						if (val != null) {
							if (item.scalar) {
								if (item.scalar > val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'max':
						val = json[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar) {
								if (item.scalar < val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'avg':
						val = json[builder.$options.scalarfield];
						if (val != null) {
							item.scalar = item.scalar ? item.scalar + val : 0;
							if (item.scalarcount)
								item.scalarcount++;
							else
								item.scalarcount = 1;
						}
						break;
					case 'group':
						!item.scalar && (item.scalar = {});
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar[val])
								item.scalar[val]++;
							else
								item.scalar[val] = 1;
						}
						break;

					default:
						if (item.response)
							item.response.push(output);
						else
							item.response = [output];
						break;
				}
			}
		}

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			var builder = item.builder;
			var output;

			if (builder.$options.scalar || !builder.$options.sort) {

				if (builder.$options.scalar)
					output = builder.$options.scalar === 'avg' ? item.scalar / item.counter : item.scalar;
				else if (builder.$options.first)
					output = item.response ? item.response[0] : undefined;
				else if (builder.$options.listing)
					output = listing(builder, item);
				else
					output = item.response || [];

				builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
				continue;
			}

			if (item.count) {
				if (builder.$options.sort.name)
					item.response.quicksort(builder.$options.sort.name, builder.$options.sort.asc);
				else if (builder.$options.sort === EMPTYOBJECT)
					item.response.random();
				else
					item.response.sort(builder.$options.sort);

				if (builder.$options.skip && builder.$options.take)
					item.response = item.response.splice(builder.$options.skip, builder.$options.take);
				else if (builder.$options.skip)
					item.response = item.response.splice(builder.$options.skip);
				else if (builder.$options.take)
					item.response = item.response.splice(0, builder.$options.take);
			}

			if (builder.$options.first)
				output = item.response ? item.response[0] : undefined;
			else if (builder.$options.listing)
				output = listing(builder, item);
			else
				output = item.response || [];

			builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
			builder.done();
		}

		callback();
	});
};

DP.$remove = function() {

	var self = this;
	self.step = 3;

	if (!self.pending_remove.length) {
		self.next(0);
		return;
	}

	self.$writting = true;

	var fs = new NoSQLStream(self.filename);
	var filter = self.pending_remove.splice(0);
	var length = filter.length;
	var change = false;
	var indexer = 0;
	var backup = false;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
		if (fil.backup || fil.builder.$options.backup)
			backup = true;
	}

	fs.ondocuments = function() {

		var docs = JSON.parse('[' + fs.docs + ']', jsonparser);

		for (var j = 0; j < docs.length; j++) {

			indexer++;
			var removed = false;
			var doc = docs[j];
			var rec = fs.docsbuffer[j];

			for (var i = 0; i < length; i++) {
				var item = filter[i];
				item.filter.index = indexer;
				var output = item.compare(doc, item.filter, indexer);
				if (output) {
					removed = true;
					doc = output;
					break;
				}
			}

			if (removed) {

				if (backup) {
					for (var i = 0; i < length; i++) {
						var item = filter[i];
						item.backup && item.backup.write(rec.doc + NEWLINE);
						item.builder.$options.backup && item.builder.$backupdoc(rec.doc);
					}
				}

				if (!change)
					change = true;

				item.count++;
				self.$events.remove && self.emit('remove', doc);
				fs.write('-' + rec.doc.substring(1) + NEWLINE, rec.position);
			}
		}
	};

	fs.$callback = function() {
		for (var i = 0; i < length; i++) {
			var item = filter[i];
			item.builder.$options.log && item.builder.log();
			item.builder.$callback && item.builder.$callback(errorhandling(null, item.builder, item.count), item.count, item.filter.repository);
		}

		fs = null;
		self.$writting = false;
		self.next(0);
		change && self.$events.change && self.emit('change', 'remove');
	};

	fs.openupdate();
};

DP.$clear = function() {

	var self = this;
	self.step = 12;

	if (!self.pending_clear.length) {
		self.next(0);
		return;
	}

	var filter = self.pending_clear.splice(0);
	Fs.unlink(self.filename, function() {
		for (var i = 0; i < filter.length; i++)
			filter[i]();
		self.$events.change && self.emit('change', 'clear');
		self.next(0);
	});
};

DP.$clean = function() {

	var self = this;
	self.step = 13;

	if (!self.pending_clean.length) {
		self.next(0);
		return;
	}

	var filter = self.pending_clean.splice(0);
	var length = filter.length;
	var now = Date.now();

	F.databasescleaner[self.name] = undefined;
	F.config['nosql-logger'] && PRINTLN('NoSQL embedded "{0}" cleaning (beg)'.format(self.name));

	var fs = new NoSQLStream(self.filename);
	var writer = Fs.createWriteStream(self.filename + '-tmp');

	fs.divider = NEWLINE;

	fs.ondocuments = function() {
		writer.write(fs.docs + NEWLINE);
	};

	fs.$callback = function() {
		writer.end();
	};

	writer.on('finish', function() {
		Fs.rename(self.filename + '-tmp', self.filename, function() {
			F.config['nosql-logger'] && PRINTLN('NoSQL embedded "{0}" cleaning (end, {1}s)'.format(self.name, (((Date.now() - now) / 1000) >> 0)));
			for (var i = 0; i < length; i++)
				filter[i]();
			self.$events.clean && self.emit('clean');
			self.next(0);
			fs = null;
		});
	});

	fs.openread();
};

DP.$lock = function() {

	var self = this;
	self.step = 14;

	if (!self.pending_locks.length) {
		self.next(0);
		return;
	}

	var filter = self.pending_locks.splice(0);
	filter.wait(function(fn, next) {
		fn.call(self, next);
	}, function() {
		self.next(0);
	});
};

DP.$remove_inmemory = function() {

	var self = this;
	self.step = 3;

	if (!self.pending_remove.length) {
		self.next(0);
		return self;
	}

	var filter = self.pending_remove.splice(0);
	var length = filter.length;
	var change = false;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
	}

	return self.$inmemory(function() {

		var data = self.inmemory['#'];
		var arr = [];

		for (var j = 0, jl = data.length; j < jl; j++) {
			var json = data[j];
			var removed = false;

			for (var i = 0; i < length; i++) {
				var item = filter[i];
				item.filter.index = j;
				if (item.compare(json, item.filter, j)) {
					removed = true;
					break;
				}
			}

			if (removed) {
				for (var i = 0; i < length; i++) {
					var item = filter[i];
					item.backup && item.backup.write(JSON.stringify(json));
					item.count++;
				}
				change = true;
				self.$events.remove && self.emit('remove', json);
			} else
				arr.push(json);
		}

		if (change) {
			self.inmemory['#'] = arr;
			self.$save();
		}

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			item.builder.$options.log && item.builder.log();
			item.builder.$callback && item.builder.$callback(errorhandling(null, item.builder, item.count), item.count);
		}

		self.next(0);
		change && self.$events.change && self.emit('change', 'remove');
	});
};

DP.$clear_inmemory = function() {

	var self = this;
	self.step = 12;

	if (!self.pending_clear.length) {
		self.next(0);
		return self;
	}

	var filter = self.pending_clear.splice(0);
	return self.$inmemory(function() {
		self.inmemory['#'] = [];
		self.$save();
		for (var i = 0; i < length; i++)
			filter[i](null);
		self.next(0);
	});
};

DP.$drop = function() {
	var self = this;
	self.step = 7;

	if (!self.pending_drops) {
		self.next(0);
		return;
	}

	self.pending_drops = false;
	var remove = [self.filename, self.filenameTemp];

	try {
		Fs.readdirSync(self.binary.directory).forEach(function(filename) {
			filename.startsWith(self.name + '#') && filename.endsWith(EXTENSION_BINARY) && remove.push(framework_utils.join(self.binary.directory, filename));
		});
	} catch (e) {}

	remove.wait((filename, next) => Fs.unlink(filename, next), function() {
		self.next(0);
		self.free(true);
		self.$events.change && self.emit('change', 'drop');
	}, 5);

	Object.keys(self.inmemory).forEach(function(key) {
		self.inmemory[key] = undefined;
	});
};

function DatabaseBuilder2(db) {
	this.$callback = NOOP;
	this.db = db;
	this.$options = {};
}

DatabaseBuilder2.prototype.promise = promise;

DatabaseBuilder2.prototype.log = function(msg, user) {
	var self = this;
	if (msg) {
		NOW = new Date();
		self.$options.log = (self.$options.log ? self.$options.log : '') + NOW.format('yyyy-MM-dd HH:mm:ss') + ' | ' + (user ? user.padRight(20) + ' | ' : '') + msg + NEWLINE;
	} else if (self.$options.log) {
		self.db.filenameLog && Fs.appendFile(self.db.filenameLog, self.$options.log, F.errorcallback);
		self.$options.log = '';
	}
	return self;
};

DatabaseBuilder2.prototype.callback = function(fn, emptyerror) {

	if (typeof(fn) === 'string') {
		var tmp = emptyerror;
		emptyerror = fn;
		fn = tmp;
	}

	this.$callback = fn;
	this.$callback_emptyerror = emptyerror;
	return this;
};

function DatabaseBuilder(db) {
	this.db = db;
	this.$take = 0;
	this.$skip = 0;
	this.$filter = [];
	this.$first = false;
	this.$scope = 0;
	this.$callback = NOOP;
	this.$code = [];
	this.$params = {};
	this.$options = {};
	this.$repository = {};
	this.$counter = 0;
	this.$keys = [];
}

DatabaseBuilder.prototype.promise = promise;

DatabaseBuilder.prototype.id = function(id) {
	this.$options.id = id;
	return this;
};

DatabaseBuilder.prototype.insert = function(fn) {
	this.$insertcallback = fn;
	return this;
};

DatabaseBuilder.prototype.log = function(msg, user) {
	var self = this;
	if (msg) {
		NOW = new Date();
		self.$options.log = (self.$options.log ? self.$options.log : '') + NOW.format('yyyy-MM-dd HH:mm:ss') + ' | ' + (user ? user.padRight(20) + ' | ' : '') + msg + NEWLINE;
	} else if (self.$options.log) {
		self.db.filenameLog && Fs.appendFile(self.db.filenameLog, self.$options.log, F.errorcallback);
		self.$options.log = '';
	}
	return self;
};

DatabaseBuilder.prototype.$callbackjoin = function(callback) {
	var self = this;
	Object.keys(self.$join).wait(function(key, next) {

		var join = self.$join[key];
		var response = self.$response;
		var unique = [];

		if (response instanceof Array && response.length) {
			for (var i = 0; i < response.length; i++) {
				var item = response[i];
				var val = item[join.b];
				if (val !== undefined && unique.indexOf(val) === -1)
					unique.push(val);
			}
		} else if (response) {
			var val = response[join.b];
			if (val !== undefined && unique.indexOf(val) === -1)
				unique.push(val);
		}

		var isTable = self.db instanceof Table;
		var db = isTable ? TABLE(join.name) : NOSQL(join.name);

		if (join.scalartype) {
			join.items = [];
			join.count = unique.length;
			for (var i = 0; i < unique.length; i++) {
				(function(val) {
					var builder = db.scalar(join.scalartype, join.scalarfield).callback(function(err, response) {
						join.items.push({ id: val, response: response });
						join.count--;
						if (join.count === 0) {
							join.count = -1;
							next();
						}
					});

					if (join.builder.$counter) {
						builder.$counter = join.builder.$counter;
						builder.$code = join.builder.$code.slice(0);
						U.extend_headers2(builder.$options, join.builder.$options);
						builder.$repository = join.builder.$repository;
						builder.$params = CLONE(join.builder.$params);
					}

					builder.$take = join.builder.$take;
					builder.$skip = join.builder.$skip;
					builder.$filter = join.builder.$filter;
					builder.$scope = join.builder.$scope;
					builder.where(join.a, val);

				})(unique[i]);
			}
		} else {

			if (unique.length) {
				join.builder.$options.fields && join.builder.$options.fields.push(join.a);
				join.builder.$callback = function(err, docs) {
					join.items = docs;
					next();
				};
				if (isTable)
					db.find(join.builder).in(join.a, unique);
				else
					db.find(join.builder).in(join.a, unique);
			} else {
				join.items = join.builder.$options.first ? null : [];
				next();
			}
		}

	}, callback, 2);

	return self;
};

DatabaseBuilder.prototype.$callback2 = function(err, response, count, repository) {
	var self = this;

	if (err || !self.$join) {
		self.$options.log && self.log();
		self.$done && setImmediate(self.$done);
		return self.$callback(err, response, count, repository);
	}

	self.$response = response;
	self.$callbackjoin(function() {

		var keys = Object.keys(self.$join);

		var jl = keys.length;
		if (response instanceof Array) {
			for (var i = 0, length = response.length; i < length; i++) {
				var item = response[i];
				for (var j = 0; j < jl; j++) {
					var join = self.$join[keys[j]];
					item[join.field] = join.scalartype ? findScalar(join.items, item[join.b]) : join.first ? findItem(join.items, join.a, item[join.b]) : findItems(join.items, join.a, item[join.b]);
				}
			}
		} else if (response) {
			for (var j = 0; j < jl; j++) {
				var join = self.$join[keys[j]];
				response[join.field] = join.scalartype ? findScalar(join.items, item[join.b]) : join.first ? findItem(join.items, join.a, response[join.b]) : findItems(join.items, join.a, response[join.b]);
			}
		}

		self.$options.log && self.log();
		self.$callback(err, response, count, repository);
		self.$done && setImmediate(self.$done);
	});

	return self;
};

function findItem(items, field, value) {
	for (var i = 0, length = items.length; i < length; i++) {
		if (items[i][field] === value)
			return items[i];
	}
}

function findScalar(items, value) {
	for (var i = 0, length = items.length; i < length; i++) {
		if (items[i].id === value)
			return items[i].response || null;
	}
	return null;
}

function findItems(items, field, value) {
	var arr = [];
	for (var i = 0, length = items.length; i < length; i++) {
		if (items[i][field] === value)
			arr.push(items[i]);
	}
	return arr;
}

DatabaseBuilder.prototype.join = function(field, name) {
	var self = this;

	if (!self.$join)
		self.$join = {};

	var key = name + '.' + field;
	var join = self.$join[key];
	if (join)
		return join;

	var item = self.$join[key] = {};
	item.field = field;
	item.name = name;
	item.builder = join = new DatabaseBuilder(self.db);

	join.on = function(a, b) {

		if (self.$options.fields)
			self.$options.fields.push(b);

		self.$join[key].a = a;
		self.$join[key].b = b;

		self.$keys && self.$keys.push(b);

		return join;
	};

	join.first = function() {
		item.first = true;
		return join;
	};

	join.scalar = function(type, field) {
		item.scalartype = type;
		item.scalarfield = field;
		return join;
	};

	join.callback = function(a, b) {
		self.callback(a, b);
		return join;
	};

	return join;
};

DatabaseBuilder.prototype.first = function() {
	this.$options.first = true;
	return this.take(1);
};

DatabaseBuilder.prototype.make = function(fn) {
	fn.call(this, this);
	return this;
};

DatabaseBuilder.prototype.filter = function(fn) {
	var self = this;

	if (!self.$functions)
		self.$functions = [];

	var index = self.$functions.push(fn) - 1;
	var code = '$is=!!fn[{0}].call($F,doc,index,repository);'.format(index);

	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	self.$counter++;
	return self;
};

DatabaseBuilder.prototype.scalar = function(type, name) {
	var self = this;
	var opt = self.$options;
	opt.scalar = type;
	opt.scalarfield = name;
	return this;
};

DatabaseBuilder.prototype.contains = function(name) {
	var self = this;
	var code = '$is=doc.{0} instanceof Array?!!doc.{0}.length:!!doc.{0};'.format(name);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';
	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	self.$counter++;
	return self;
};

DatabaseBuilder.prototype.empty = function(name) {
	var self = this;
	var code = '$is=doc.{0} instanceof Array?!doc.{0}.length:!doc.{0};'.format(name);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';
	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	self.$counter++;
	return self;
};

DatabaseBuilder.prototype.backup = function(user) {
	if (this.db.filenameBackup)
		this.$options.backup = typeof(user) === 'string' ? user : 'unknown';
	else
		this.$options.backup = null;
	return this;
};

DatabaseBuilder.prototype.$backupdoc = function(doc) {
	this.db.filenameBackup && Fs.appendFile(this.db.filenameBackup, NOW.format('yyyy-MM-dd HH:mm') + ' | ' + this.$options.backup.padRight(20) + ' | ' + (typeof(doc) === 'string' ? doc : JSON.stringify(doc)) + NEWLINE, F.errorcallback);
	return this;
};

DatabaseBuilder.prototype.where = function(name, operator, value) {

	var self = this;
	var key = 'w' + (self.$counter++);
	var code;

	if (value === undefined) {
		value = operator;
		operator = '=';
	}

	var date = framework_utils.isDate(value);
	self.$params[key] = date ? value.getTime() : value;

	switch (operator) {
		case '=':
			operator = '==';
			break;
		case '<>':
			operator = '!=';
			break;
	}

	code = (date ? '$is=(doc.{0} instanceof Date?doc.{0}:new Date(doc.{0})).getTime(){2}arg.{1};' : '$is=doc.{0}{2}arg.{1};');

	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$keys && self.$keys.push(name);
	self.$code.push(code.format(name, key, operator));
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.query = function(code) {
	var self = this;

	code = '$is=(' + code + ');';

	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	if (self.$keys)
		self.$keys = null;

	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	self.$counter++;
	return self;
};

DatabaseBuilder.prototype.month = function(name, operator, value) {
	var self = this;
	var key = 'dm' + (self.$counter++);

	if (value === undefined) {
		value = operator;
		operator = '=';
	}

	self.$params[key] = value;

	var code = compare_datetype('month', name, key, operator);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$keys && self.$keys.push(name);
	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.day = function(name, operator, value) {
	var self = this;
	var key = 'dd' + (self.$counter++);

	if (value === undefined) {
		value = operator;
		operator = '=';
	}

	self.$params[key] = value;

	var code = compare_datetype('day', name, key, operator);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$keys && self.$keys.push(name);
	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.year = function(name, operator, value) {
	var self = this;
	var key = 'dy' + (self.$counter++);

	if (value === undefined) {
		value = operator;
		operator = '=';
	}

	self.$params[key] = value;

	var code = compare_datetype('year', name, key, operator);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$keys && self.$keys.push(name);

	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.like = DatabaseBuilder.prototype.search = function(name, value, where) {

	var self = this;
	var code;
	var key = 'l' + (self.$counter++);

	if (!where)
		where = '*';

	switch (where) {
		case 'beg':
			code = '$is=doc.{0}?doc.{0}.startsWith(arg.{1}):false;';
			break;
		case 'end':
			code = '$is=doc.{0}?doc.{0}.endsWith(arg.{1}):false;';
			break;
		case '*':
			code = '$is=false;if(doc.{0}){if(doc.{0} instanceof Array){for(var $i=0;$i<doc.{0}.length;$i++){if(doc.{0}[$i].toLowerCase().indexOf(arg.{1})!==-1){$is=true;break;}}}else{$is=doc.{0}.toLowerCase?doc.{0}.toLowerCase().indexOf(arg.{1})!==-1:false}}';
			if (value instanceof Array)
				value = value.join(' ');
			value = value.toLowerCase();
			break;
	}

	self.$params[key] = value;

	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$keys && self.$keys.push(name);
	self.$code.push(code.format(name, key));
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.regexp = function(name, value) {
	var self = this;
	var code = '$is=false;if(doc.{0}&&doc.{0}.toLowerCase){$is=({1}).test(doc.{0})}';
	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$keys && self.$keys.push(name);
	self.$code.push(code.format(name, value.toString()));
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.fulltext = function(name, value, weight) {

	var self = this;
	var key = 'l' + (self.$counter++);

	if (value instanceof Array) {
		for (var i = 0; i < value.length; i++)
			value[i] = value[i].toLowerCase();
	} else {
		if (REGCHINA.test(value))
			value = value.split('');
		else
			value = value.toLowerCase().split(' ');
	}

	self.$keys && self.$keys.push(name);

	var count = 1;
	if (weight)
		count = ((value.length / 100) * weight) >> 0;

	var code = '$is=false;if(doc.{0}&&doc.{0}.toLowerCase){var $a={2},$b=doc.{0}.toLowerCase();for(var $i=0;$i<arg.{1}.length;$i++){if($b.indexOf(arg.{1}[$i])!==-1){$a--;if(!$a){$is=true;break}}}}';
	self.$params[key] = value;
	if (self.$scope)
		code = 'if(!$is){' + code + '}';
	self.$code.push(code.format(name, key, count || 1));
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder2.prototype.stringify = DatabaseBuilder.prototype.stringify = function() {
	var obj = {};
	obj.options = this.$options;
	obj.code = this.$code;
	obj.params = this.$params;
	if (this.$functions) {
		obj.functions = [];
		for (var i = 0; i < this.$functions.length; i++)
			obj.functions.push(this.$functions[i].toString());
	}

	if (this.$repository)
		obj.repository = this.$repository;

	return JSON.stringify(obj);
};

DatabaseBuilder2.prototype.parse = DatabaseBuilder.prototype.parse = function(data) {
	data = JSON.parse(data, jsonparser);
	this.$options = data.options;
	this.$code = data.code;
	this.$params = data.params;
	this.$take = data.options.take;
	this.$skip = data.options.skip;
	this.$repository = data.repository;

	if (data.functions) {
		for (var i = 0; i < data.functions.length; i++)
			data.functions[i] = eval('(' + data.functions[i] + ')');
		this.$functions = data.functions;
	}

	return this;
};

DatabaseBuilder.prototype.take = function(count) {
	this.$take = this.$options.take = count;
	return this;
};

DatabaseBuilder.prototype.limit = function(count) {
	this.$take = this.$options.take = count;
	return this;
};

DatabaseBuilder.prototype.page = function(page, limit) {
	if (limit)
		this.$take = this.$options.take = limit;
	this.$skip = this.$options.skip = page * this.$take;
	return this;
};

DatabaseBuilder.prototype.paginate = function(page, limit, maxlimit) {

	var limit2 = +(limit || 0);
	var page2 = (+(page || 0)) - 1;

	if (page2 < 0)
		page2 = 0;

	if (maxlimit && limit2 > maxlimit)
		limit2 = maxlimit;

	if (!limit2)
		limit2 = maxlimit;

	this.$skip = this.$options.skip = page2 * limit2;
	this.$take = this.$options.take = limit2;
	return this;
};

DatabaseBuilder.prototype.skip = function(count) {
	this.$take = this.$options.skip = count;
	return this;
};

DatabaseBuilder.prototype.callback = function(fn, emptyerror) {

	if (typeof(fn) === 'string') {
		var tmp = emptyerror;
		emptyerror = fn;
		fn = tmp;
	}

	this.$callback = fn;
	this.$callback_emptyerror = emptyerror;
	return this;
};

DatabaseBuilder.prototype.random = function() {
	this.$options.sort = null;
	return this;
};

DatabaseBuilder.prototype.sort = function(name, desc) {
	this.$options.sort = { name: name, asc: desc ? false : true };
	return this;
};

DatabaseBuilder.prototype.repository = function(key, value) {
	if (key === undefined)
		return this.$repository;
	if (value === undefined)
		return this.$repository[key];
	this.$repository[key] = value;
	return this;
};

DatabaseBuilder.prototype.compile = function(noTrimmer) {
	var self = this;
	var raw = self.$code.join('');
	var code = 'var repository=$F.repository,options=$F.options,arg=$F.arg,fn=$F.fn,$is=false,$tmp;var R=repository;' + raw + (self.$code.length && raw.substring(raw.length - 7) !== 'return;' ? 'if(!$is)return;' : '') + (noTrimmer ? 'return doc' : 'if(options.fields){var $doc={};for(var $i=0;$i<options.fields.length;$i++){var prop=options.fields[$i];$doc[prop]=doc[prop]}if(options.sort)$doc[options.sort.name]=doc[options.sort.name];return $doc}else if(options.fields2){var $doc={};var $keys=Object.keys(doc);for(var $i=0;$i<$keys.length;$i++){var prop=$keys[$i];!options.fields2[prop]&&($doc[prop]=doc[prop])}return $doc}else{return doc}');
	var opt = self.$options;
	self.$inlinesort = !!(opt.take && opt.sort && opt.sort !== null);
	self.$limit = (opt.take || 0) + (opt.skip || 0);
	var key = opt.id ? self.db.name + '_' + opt.id : code.hash();
	return CACHE[key] ? CACHE[key] : (CACHE[key] = new Function('doc', '$F', 'index', code));
};

DatabaseBuilder.prototype.in = function(name, value) {
	var self = this;
	var key = 'in' + (self.$counter++);
	self.$keys && self.$keys.push(name);
	self.$params[key] = value instanceof Array ? value : [value];
	var code = 'if($is)$is=false;$tmp=doc.{0};if($tmp instanceof Array){for(var $i=0;$i<$tmp.length;$i++){if(arg.{1}.indexOf($tmp[$i])!==-1){$is=true;break}}}else{if(arg.{1}.indexOf($tmp)!==-1)$is=true}'.format(name, key);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';
	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.notin = function(name, value) {
	var self = this;
	var key = 'in' + (self.$counter++);
	self.$keys && self.$keys.push(name);
	self.$params[key] = value instanceof Array ? value : [value];
	var code = '$is=true;$tmp=doc.{0};if($tmp instanceof Array){for(var $i=0;$i<$tmp.length;$i++){if(arg.{1}.indexOf($tmp[$i])!==-1){$is=false;break}}}else{if(arg.{1}.indexOf($tmp)!==-1)$is=false}'.format(name, key);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';
	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.between = function(name, a, b) {
	var self = this;
	var keya = 'ba' + (self.$counter++);
	var keyb = 'bb' + (self.$counter++);
	var code = '$is=doc.{0}>=arg.{1}&&doc.{0}<=arg.{2};'.format(name, keya, keyb);
	if (self.$scope)
		code = 'if(!$is){' + code + '}';
	self.$keys && self.$keys.push(name);
	self.$params[keya] = a;
	self.$params[keyb] = b;
	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	return self;
};

DatabaseBuilder.prototype.or = function() {
	this.$code.push('$is=false;');
	this.$scope = 1;
	return this;
};

DatabaseBuilder.prototype.end = function() {
	this.$scope = 0;
	this.$code.push('if(!$is)return;');
	return this;
};

DatabaseBuilder.prototype.and = function() {
	this.$code.push('$is=false;');
	this.$scope = 0;
	return this;
};

DatabaseBuilder.prototype.done = function() {
	this.$options = {};
	this.$code = [];
	return this;
};

DatabaseBuilder.prototype.cache = function() {
	// this.$cache_key = '$nosql_' + key;
	// this.$cache_expire = expire;
	OBSOLETE('DatabaseBuilder.cache()', 'NoSQL database supports in-memory mode.');
	return this;
};

DatabaseBuilder.prototype.fields = function() {
	var self = this;
	var opt = self.$options;
	for (var i = 0, length = arguments.length; i < length; i++) {
		var name = arguments[i];
		if (name[0] === '-') {
			!opt.fields2 && (opt.fields2 = {});
			opt.fields2[name.substring(1)] = 1;
		} else {
			!opt.fields && (opt.fields = []);
			opt.fields.push(name);
		}
		self.$keys && self.$keys.push(name);
	}
	return self;
};

DatabaseBuilder.prototype.code = function(code) {
	var self = this;

	if (typeof(code) === 'function') {
		code = code.toString();
		code = code.substring(code.indexOf('{') + 1, code.lastIndexOf('}'));
	}

	code = code.trim();

	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	self.$code.push(code + ';');
	!self.$scope && self.$code.push('if(!$is)return;');

	if (self.$keys)
		self.$keys = null;

	return self;
};

DatabaseBuilder.prototype.prepare = function(fn) {
	var self = this;

	if (!self.$functions)
		self.$functions = [];

	var index = self.$functions.push(fn) - 1;
	var code = '$tmp=fn[{0}].call($F,U.clone(doc),index,repository);if(typeof($tmp)==\'boolean\'){$is=$tmp}else{doc=$tmp;$is=$tmp!=null}'.format(index);

	if (self.$scope)
		code = 'if(!$is){' + code + '}';

	if (self.$keys)
		self.$keys = null;

	self.$code.push(code);
	!self.$scope && self.$code.push('if(!$is)return;');
	return this;
};

function Counter(db) {
	var t = this;
	t.TIMEOUT = 30000;
	t.db = db;
	t.cache;
	t.key = (db instanceof Table ? 'table' : 'nosql') + db.name.hash();
	t.type = 0; // 1 === saving, 2 === reading
	t.$events = {};
}

const CP = Counter.prototype;

CP.emit = function(name, a, b, c, d, e, f, g) {
	var evt = this.$events[name];
	if (evt) {
		var clean = false;
		for (var i = 0, length = evt.length; i < length; i++) {
			if (evt[i].$once)
				clean = true;
			evt[i].call(this, a, b, c, d, e, f, g);
		}
		if (clean) {
			evt = evt.remove(n => n.$once);
			if (evt.length)
				this.$events[name] = evt;
			else
				this.$events[name] = undefined;
		}
	}
	return this;
};

CP.on = function(name, fn) {

	if (!fn.$once)
		this.db.$free = false;

	if (this.$events[name])
		this.$events[name].push(fn);
	else
		this.$events[name] = [fn];

	return this;
};

CP.once = function(name, fn) {
	fn.$once = true;
	return this.on(name, fn);
};

CP.removeListener = function(name, fn) {
	var evt = this.$events[name];
	if (evt) {
		evt = evt.remove(n => n === fn);
		if (evt.length)
			this.$events[name] = evt;
		else
			this.$events[name] = undefined;
	}
	return this;
};

CP.removeAllListeners = function(name) {
	if (name === true)
		this.$events = EMPTYOBJECT;
	else if (name)
		this.$events[name] = undefined;
	else
		this.$events = {};
	return this;
};

CP.empty = function(key, value) {
	var self = this;
	!self.cache && (self.cache = {});

	// key[2] = su[m]
	// max
	// min
	// mma
	// avg

	self.cache[key] = key[2] === 'm' ? value : [value, value];
	return self;
};

CP.min = function(id, count) {

	var self = this;

	if (id instanceof Array) {
		for (var i = 0, length = id.length; i < length; i++)
			self.min(id[i], count);
		return self;
	}

	var key = 'mma' + NOW.getFullYear() + '' + id;

	if (!self.cache || !self.cache[key])
		self.empty(key, count);
	else {
		var arr = self.cache[key];
		if (arr[0] > count) // min
			arr[0] = count;
		if (arr[1] < count) // max
			arr[1] = count;
	}

	setTimeout2(self.key, () => self.save(), self.TIMEOUT, 5);
	this.$events.min && self.emit('min', id, count || 1);
	return self;
};

CP.max = function(id, count) {

	var self = this;

	if (id instanceof Array) {
		for (var i = 0, length = id.length; i < length; i++)
			self.min(id[i], count);
		return self;
	}

	var key = 'mma' + NOW.getFullYear() + '' + id;
	if (!self.cache || !self.cache[key])
		self.empty(key, count);
	else {
		var arr = self.cache[key];
		if (arr[0] > count) // min
			arr[0] = count;
		if (arr[1] < count) // max
			arr[1] = count;
	}

	setTimeout2(self.key, () => self.save(), self.TIMEOUT, 5);
	this.$events.max && self.emit('max', id, count || 1);
	return self;
};

CP.inc = CP.hit = function(id, count) {

	var self = this;

	if (id instanceof Array) {
		for (var i = 0, length = id.length; i < length; i++)
			self.min(id[i], count);
		return self;
	}

	var key = 'sum' + NOW.getFullYear() + '' + id;
	if (!self.cache || !self.cache[key])
		self.empty(key, count || 1);
	else
		self.cache[key] += count || 1;

	setTimeout2(self.key, () => self.save(), self.TIMEOUT, 5);
	this.$events.sum && self.emit('sum', id, count || 1);
	this.$events.hits && self.emit('hit', id, count || 1);
	return self;
};

CP.remove = function(id) {
	var self = this;

	!self.cache && (self.cache = {});

	if (id instanceof Array)
		id.forEach(n => self.cache[n] = null);
	else
		self.cache[id] = null;

	setTimeout2(self.key, () => self.save(), self.TIMEOUT, 5);
	self.emit('remove', id);
	return self;
};

CP.count = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 0;
	options.id = id;
	options.type = 'sum';
	return this.read(options, callback);
};

CP.maximum = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 0;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'max';
	return this.read(options, callback);
};

CP.minimum = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 0;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'min';
	return this.read(options, callback);
};

CP.yearly = CP.yearly_sum = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 1;
	options.id = id;
	options.type = 'sum';
	return this.read(options, callback);
};

CP.monthly = CP.monthly_sum = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 2;
	options.id = id;
	options.type = 'sum';
	return this.read(options, callback);
};

CP.daily = CP.daily_sum = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 3;
	options.id = id;
	options.type = 'sum';
	return this.read(options, callback);
};

CP.yearly_max = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 1;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'max';
	return this.read(options, callback);
};

CP.monthly_max = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 2;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'max';
	return this.read(options, callback);
};

CP.daily_max = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 3;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'max';
	return this.read(options, callback);
};

CP.yearly_min = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 1;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'min';
	return this.read(options, callback);
};

CP.monthly_min = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 2;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'min';
	return this.read(options, callback);
};

CP.daily_min = function(id, callback) {

	if (typeof(id) === 'function') {
		callback = id;
		id = null;
	}

	var options = {};
	options.subtype = 3;
	options.id = id;
	options.type = 'mma';
	options.type2 = 'min';
	return this.read(options, callback);
};

CP.read = function(options, callback, reader) {

	var self = this;

	if (self.type && reader === undefined) {
		setTimeout(() => self.read(options, callback), 200);
		return self;
	}

	self.type = 2;

	if (self.db.readonly) {
		if (reader === undefined) {
			U.download(self.db.filenameCounter, FLAGS_READ, function(err, response) {
				self.read(options, callback, err ? null : response);
			});
			return self;
		}
	} else
		reader = Fs.createReadStream(self.db.filenameCounter);

	// 0 == options.subtype: summarize
	// 1 == options.subtype: full

	var keys = {};
	var single = false;
	var all = options.id ? false : true;
	var output = all && !options.subtype ? null : {};

	if (typeof(options.id) === 'string') {
		options.id = [options.id];
		single = true;
	}

	if (options.id) {
		for (var i = 0, length = options.id.length; i < length; i++)
			keys[options.type + options.id[i]] = true;
	}

	if (reader) {

		reader.on('error', function() {
			self.type = 0;
			callback(null, single ? (options.subtype ? EMPTYARRAY : 0) : (all ? EMPTYARRAY : output));
		});

		reader.on('data', framework_utils.streamer(NEWLINEBUF, function(value, index) {

			var index = value.indexOf('=');
			var key = value.substring(7, index);
			var type = value.substring(0, 3);

			if (options.type !== type)
				return;

			var tmp;
			var year = value.substring(3, 7);

			if (all || options.id === true || keys[type + key]) {
				switch (options.subtype) {
					case 0:
						var val = value.substring(index + 1, value.indexOf(';'));
						switch (options.type2 || options.type) {
							case 'max':
								var a = counter_minmax(options, val);
								if (all) {
									if (output == null)
										output = a;
									else if (output < a)
										output = a;
								} else
									output[key] = a;
								break;
							case 'min':
								var a = counter_minmax(options, val);
								if (all) {
									if (output == null)
										output = a;
									else if (output > a)
										output = a;
								} else
									output[key] = a;
								break;
							case 'sum':
								if (all)
									output = (output || 0) + (+val);
								else
									output[key] = +val;
								break;
						}
						break;
					case 1:
						if (all)
							counter_parse_years_all(output, value, year, options);
						else {
							tmp = counter_parse_years(value, year, options);
							if (output[key])
								output[key].push.apply(output[key], tmp);
							else
								output[key] = tmp;
						}
						break;
					case 2:
						if (all)
							counter_parse_months_all(output, value, year, options);
						else {
							tmp = counter_parse_months(value, year, options);
							if (output[key])
								output[key].push.apply(output[key], tmp);
							else
								output[key] = tmp;
						}
						break;
					case 3:
						if (all)
							counter_parse_days_all(output, value, year, options);
						else {
							tmp = counter_parse_days(value, year, options);
							if (output[key])
								output[key].push.apply(output[key], tmp);
							else
								output[key] = tmp;
						}
						break;
				}
			}
		}));
	}

	var finish = function() {
		self.type = 0;
		// Array conversation
		if (all && options.subtype) {
			var tmp = [];
			var keys;
			switch (options.subtype) {
				case 3: // daily
					keys = Object.keys(output);
					for (var i = 0, length = keys.length; i < length; i++) {
						var key = keys[i];
						tmp.push({ id: key, year: +key.substring(0, 4), month: +key.substring(4, 6), day: +key.substring(6, 8), value: output[key] });
					}
					break;
				case 2: // monthly
					keys = Object.keys(output);
					for (var i = 0, length = keys.length; i < length; i++) {
						var key = keys[i];
						tmp.push({ id: key, year: +key.substring(0, 4), month: +key.substring(4, 6), value: output[key] });
					}
					break;
				case 1: // yearly
					keys = Object.keys(output);
					for (var i = 0, length = keys.length; i < length; i++) {
						var key = keys[i];
						tmp.push({ id: key, year: +key.substring(0, 4), value: output[key] });
					}
					break;
			}
			output = tmp;
		}

		callback(null, single ? (options.subtype ? output[options.id[0]] || EMPTYARRAY : output[options.id[0]] || 0) : output);
	};

	if (reader)
		reader.on('end', finish);
	else
		finish();

	return self;
};

CP.stats_max = function(top, year, month, day, callback) {
	return this.stats(top, year, month, day, 'max', callback);
};

CP.stats_min = function(top, year, month, day, callback) {
	return this.stats(top, year, month, day, 'min', callback);
};

CP.stats = CP.stats_sum = function(top, year, month, day, type, callback, reader) {

	var self = this;

	if (self.type && reader === undefined) {
		setTimeout(() => self.stats(top, year, month, day, type, callback), 200);
		return self;
	}

	self.type = 3;

	if (self.db.readonly) {
		if (reader === undefined) {
			U.download(self.db.filenameCounter, FLAGS_READ, function(err, response) {
				if (err) {
					self.type = 0;
					callback && callback(err, []);
				} else
					self.stats(top, year, month, day, type, callback, response);
			});
			return self;
		}
	} else
		reader = Fs.createReadStream(self.db.filenameCounter);

	if (typeof(day) == 'function') {
		callback = day;
		day = null;
	} else if (typeof(month) == 'function') {
		callback = month;
		month = null;
	} else if (typeof(year) === 'function') {
		callback = year;
		year = month = null;
	}

	var date = null;
	var output = [];

	if (!type)
		type = 'sum';

	if (year) {
		if (day) {
			date = month.padLeft(2, '0') + day.padLeft(2, '0');
			date = new RegExp(';' + date + '=[0-9X\\.]+', 'g');
		} else if (month) {
			date = month.padLeft(2, '0') + '\\d{2}';
			date = new RegExp(';' + date + '=[0-9X\\.]+', 'g');
		}
	}

	reader.on('error', function() {
		self.type = 0;
		callback && callback(null, output);
	});

	if (year > 0)
		year = year.toString();

	var opt = {};

	if (type !== 'sum') {
		opt.type = 'mma';
		opt.type2 = type;
	} else
		opt.type = type;

	reader.on('data', framework_utils.streamer(NEWLINEBUF, function(value, index) {

		var index = value.indexOf('=');
		if (value.substring(0, 3) !== opt.type || (year && value.substring(3, 7) !== year))
			return;

		var count = null;

		if (date) {
			var matches = value.match(date);
			if (!matches)
				return;
			count = counter_parse_stats(matches, opt);
		} else {
			var val = value.substring(index + 1, value.indexOf(';', index));
			count = opt.type2 ? counter_minmax(opt, val) : +val;
		}

		count != null && counter_parse_stats_avg(output, top, value.substring(7, index), count, type, undefined, year == null && month == null && day == null);
	}));

	reader.on('end', function() {
		self.type = 0;
		output.sort(counter_sort_sum);
		callback && callback(null, output);
	});

	return self;
};

function counter_sort_sum(a, b) {
	return a.count > b.count ? -1 : a.count === b.count ? 0 : 1;
}

function counter_sort_min(a, b) {
	return a.count > b.count ? 1 : a.count === b.count ? 0 : -1;
}

function counter_parse_stats_avg(group, top, key, count, opt) {

	var length = group.length;

	if (length < top) {
		for (var i = 0; i < length; i++) {
			if (group[i].id === key) {
				group[i].count += count;
				return;
			}
		}

		group.push({ id: key, count: count });
		if (group.length === top) {
			switch (opt.type2 || opt.type) {
				case 'max':
				case 'sum':
					group.sort(counter_sort_sum);
					break;
				case 'min':
					group.sort(counter_sort_min);
					break;
			}
		}
		return;
	}

	for (var i = 0; i < length; i++) {
		if (group[i].id === key) {
			group[i].count += count;
			return;
		}
	}

	for (var i = 0; i < length; i++) {
		var item = group[i];

		if (opt.type === 'min') {
			if (item.count < count)
				continue;
		} else if (item.count > count)
			continue;

		for (var j = length - 1; j > i; j--) {
			group[j].id = group[j - 1].id;
			group[j].count = group[j - 1].count;
		}

		item.id = key;
		item.count = count;
		return;
	}
}

function counter_parse_stats(matches, opt) {

	var value = null;

	for (var i = 0, length = matches.length; i < length; i++) {
		var item = matches[i];
		var val = item.substring(item.indexOf('=', 3) + 1);

		switch (opt.type2 || opt.type) {
			case 'max':
				var a = counter_minmax(opt, val);
				if (value == null)
					value = a;
				else if (value < a)
					value = a;
				break;
			case 'min':
				var a = counter_minmax(opt, val);
				if (value == null)
					value = a;
				else if (value > a)
					value = a;
				break;
			case 'sum':
				value += +val;
				break;
		}
	}

	return value;
}

function counter_minmax(opt, val) {
	var index = val.indexOf('X');
	switch (opt.type2) {
		case 'min':
			return +val.substring(0, index);
		case 'max':
			return +val.substring(index + 1);
		case 'avg':
			return ((+val.substring(0, index)) + (+val.substring(index + 1))) / 2;
	}
}

function counter_parse_years(value, year, opt) {

	var arr = value.trim().split(';');
	var tmp = {};

	for (var i = 1, length = arr.length; i < length; i++) {
		var val = arr[i].substring(5);
		if (tmp[year]) {
			switch (opt.type2 || opt.type) {
				case 'max':
					var a = counter_minmax(opt, val);
					if (tmp[year].value < a)
						tmp[year].value = a;
					break;
				case 'min':
					var a = counter_minmax(opt, val);
					if (tmp[year].value > a)
						tmp[year].value = a;
					break;
				case 'sum':
					tmp[year].value += +val;
					break;
			}
		} else
			tmp[year] = { id: year, year: +year, value: opt.type2 ? counter_minmax(opt, val) : +val };
	}

	var output = [];
	var keys = Object.keys(tmp);
	for (var i = 0, length = keys.length; i < length; i++)
		output.push(tmp[keys[i]]);

	return output;
}

function counter_parse_months(value, year, opt) {

	var arr = value.trim().split(';');
	var tmp = {};

	for (var i = 1, length = arr.length; i < length; i++) {
		var val = arr[i].substring(5);
		var key = year + arr[i].substring(0, 2);

		if (tmp[key]) {
			switch (opt.type2 || opt.type) {
				case 'max':
					var a = counter_minmax(opt, val);
					if (tmp[key].value < a)
						tmp[key].value = a;
					break;
				case 'min':
					var a = counter_minmax(opt, val);
					if (tmp[key].value > a)
						tmp[key].value = a;
					break;
				case 'sum':
					tmp[key].value += +val;
					break;
			}
		} else
			tmp[key] = { id: key, year: +year, month: +key.substring(4), value: opt.type2 ? counter_minmax(opt, val) : +val };
	}

	var output = [];
	var keys = Object.keys(tmp);
	for (var i = 0, length = keys.length; i < length; i++)
		output.push(tmp[keys[i]]);

	return output;
}

function counter_parse_days(value, year, opt) {

	var arr = value.trim().split(';');
	var tmp = {};

	for (var i = 1, length = arr.length; i < length; i++) {
		var val = arr[i].substring(5);
		var key = year + arr[i].substring(0, 4);

		if (tmp[key]) {
			switch (opt.type2 || opt.type) {
				case 'max':
					var a = counter_minmax(opt, val);
					if (tmp[key].value < a)
						tmp[key].value = a;
					break;
				case 'min':
					var a = counter_minmax(opt, val);
					if (tmp[key].value > a)
						tmp[key].value = a;
					break;
				case 'sum':
					tmp[key].value += +val;
					break;
			}
		} else
			tmp[key] = { id: key, year: +year, month: +key.substring(4, 6), day: +key.substring(6), value: opt.type2 ? counter_minmax(opt, val) : +val };
	}

	var output = [];
	var keys = Object.keys(tmp);
	for (var i = 0, length = keys.length; i < length; i++)
		output.push(tmp[keys[i]]);
	return output;
}

function counter_parse_years_all(output, value, year, opt) {
	var arr = value.trim().split(';');
	for (var i = 1, length = arr.length; i < length; i++) {

		var val = arr[i].substring(5);

		if (!output[year]) {
			output[year] = opt.type2 ? counter_minmax(opt, val) : +val;
			continue;
		}

		switch (opt.type2 || opt.type) {
			case 'max':
				var a = counter_minmax(opt, val);
				if (output[year] < a)
					output[year] = a;
				break;
			case 'min':
				var a = counter_minmax(opt, val);
				if (output[year] > a)
					output[year] = a;
				break;
			case 'sum':
				output[year] += +val;
				break;
		}
	}
}

function counter_parse_months_all(output, value, year, opt) {
	var arr = value.trim().split(';');

	for (var i = 1, length = arr.length; i < length; i++) {
		var val = arr[i].substring(5);
		var key = year + arr[i].substring(0, 2);

		if (!output[key]) {
			output[key] = opt.type2 ? counter_minmax(opt, val) : +val;
			continue;
		}

		switch (opt.type2 || opt.type) {
			case 'max':
				var a = counter_minmax(opt, val);
				if (output[year] < a)
					output[year] = a;
				break;
			case 'min':
				var a = counter_minmax(opt, val);
				if (output[year] > a)
					output[year] = a;
				break;
			case 'sum':
				output[key] += +val;
				break;
		}
	}
}

function counter_parse_days_all(output, value, year, opt) {
	var arr = value.trim().split(';');
	for (var i = 1, length = arr.length; i < length; i++) {
		var val = arr[i].substring(5);
		var key = year + arr[i].substring(0, 4);

		if (!output[key]) {
			output[key] = opt.type2 ? counter_minmax(opt, val) : +val;
			continue;
		}

		switch (opt.type2 || opt.type) {
			case 'max':
				var a = counter_minmax(opt, val);
				if (output[year] < a)
					output[year] = a;
				break;
			case 'min':
				var a = counter_minmax(opt, val);
				if (output[year] > a)
					output[year] = a;
				break;
			case 'sum':
				output[key] += +val;
				break;
		}
	}
}

CP.save = function() {

	var self = this;
	self.db.readonly && self.db.throwReadonly();

	if (self.type) {
		setTimeout(() => self.save(), 200);
		return self;
	}

	var filename = self.db.filename + EXTENSION_COUNTER;
	var reader = Fs.createReadStream(filename);
	var writer = Fs.createWriteStream(filename + '-tmp');
	var dt = NOW.format('MMdd') + '=';
	var cache = self.cache;
	var counter = 0;

	self.cache = null;
	self.type = 1;

	var flush = function() {
		var keys = Object.keys(cache);
		for (var i = 0, length = keys.length; i < length; i++) {
			var item = cache[keys[i]];
			if (item != null) {
				var val = (item instanceof Array ? (item[0] + 'X' + item[1]) : item);
				writer.write(keys[i] + '=' + val + ';' + dt + val + NEWLINE);
				counter++;
			}
		}
		writer.end();
	};

	reader.on('data', framework_utils.streamer(NEWLINEBUF, function(value, index) {

		var id = value.substring(0, value.indexOf('='));
		var count = cache[id];

		if (count === null)
			return;

		if (count === undefined) {
			writer.write(value);
			return;
		}

		// 0 === typeYEARid=COUNT
		// N === MMdd=COUNT

		var arr = value.trim().split(';');
		var is = false;
		var index = arr[0].indexOf('=');
		var type = id.substring(0, 3);

		// Update summarization
		switch (type) {
			case 'mma': // min, max, avg
				var tmp = arr[0].substring(index + 1);
				var tmpi = tmp.indexOf('X');
				COUNTER_MMA[0] = +tmp.substring(0, tmpi);
				COUNTER_MMA[1] = +tmp.substring(tmpi + 1);
				if (COUNTER_MMA[0] > count[0]) // min
					COUNTER_MMA[0] = count[0];
				if (COUNTER_MMA[1] < count[1]) // max
					COUNTER_MMA[1] = count[1];
				arr[0] = arr[0].substring(0, index + 1) + COUNTER_MMA[0] + 'X' + COUNTER_MMA[1];
				break;
			case 'max':
				arr[0] = arr[0].substring(0, index + 1) + Math.max(+arr[0].substring(index + 1), count);
				break;
			case 'min':
				arr[0] = arr[0].substring(0, index + 1) + Math.min(+arr[0].substring(index + 1), count);
				break;
			case 'sum':
				arr[0] = arr[0].substring(0, index + 1) + (+arr[0].substring(index + 1) + count);
				break;
		}

		for (var i = 1, length = arr.length; i < length; i++) {

			var item = arr[i];
			var curr = item.substring(0, 5); // MMdd

			if (curr === dt) {
				is = true;
				switch (type) {
					case 'mma':
						var tmp = item.substring(5);
						var tmpi = tmp.indexOf('X');
						COUNTER_MMA[0] = +tmp.substring(0, tmpi);
						COUNTER_MMA[1] = +tmp.substring(tmpi + 1);
						if (COUNTER_MMA[0] > count[0]) // min
							COUNTER_MMA[0] = count[0];
						if (COUNTER_MMA[1] < count[1]) // max
							COUNTER_MMA[1] = count[1];
						arr[i] = curr + COUNTER_MMA[0] + 'X' + COUNTER_MMA[1];
						break;
					case 'sum':
						arr[i] = curr + (+item.substring(5) + count);
						break;
				}
				break;
			}
		}

		cache[id] = undefined;
		!is && arr.push(dt + (count instanceof Array ? (count[0] + 'X' + count[1]) : count));
		writer.write(arr.join(';') + NEWLINE);
		counter++;
	}));

	reader.on('error', flush);
	reader.on('end', flush);

	CLEANUP(writer, function() {
		Fs.rename(filename + '-tmp', filename, function() {
			clearTimeout(self.timeout);
			self.timeout = 0;
			self.type = 0;
			counter && self.$events.stats && setImmediate(() => self.emit('stats', counter));
		});
	});

	return self;
};

CP.clear = function(callback) {
	var self = this;

	if (self.type) {
		setTimeout(() => self.clear(callback), 200);
		return self;
	}

	self.type = 3;

	Fs.unlink(self.db.filename + EXTENSION_COUNTER, function() {
		self.type = 0;
		self.emit('clear');
		callback && callback();
	});

	return self;
};

function Binary(db, directory, ext) {
	var t = this;
	t.db = db;
	t.ext = ext || EXTENSION_BINARY;
	t.directory = directory;
	t.$events = {};
	t.metafile = directory + 'meta.json';
	t.meta = { $version: 1, updated: NOW };
	t.cachekey = 'nobin_' + db.name + '_';
	t.$refresh();
}

Binary.prototype.$refresh = function() {
	this.meta.index = 0;
	this.meta.count = 0;
	this.meta.free = [];
	try {
		var json = Fs.readFileSync(this.metafile, 'utf8').toString();
		if (json.length) {
			var config = JSON.parse(json, jsonparser);
			this.meta.index = config.index;
			this.meta.count = config.count;
			this.meta.free = config.free || [];
			this.meta.updated = config.updated || NOW;
		}
	} catch(e) {}
};

Binary.prototype.$save = function() {
	var self = this;
	self.check();
	self.meta.updated = NOW;
	Fs.writeFile(self.metafile, JSON.stringify(self.meta), F.error());
	return self;
};

Binary.prototype.$directoryindex = function(index) {
	return Math.floor(index / 1000) + 1;
};

Binary.prototype.$directory = function(index, dir) {
	var self = this;
	var id = (dir ? index : self.$directoryindex(index)).toString().padLeft(DIRECTORYLENGTH, '0');
	var length = id.length;
	var directory = '';

	for (var i = 0; i < length; i++)
		directory += (i % 3 === 0 && i > 0 ? '-' : '') + id[i];

	return Path.join(self.directory, directory);
};

Binary.prototype.emit = function(name, a, b, c, d, e, f, g) {
	var evt = this.$events[name];
	if (evt) {
		var clean = false;
		for (var i = 0, length = evt.length; i < length; i++) {
			if (evt[i].$once)
				clean = true;
			evt[i].call(this, a, b, c, d, e, f, g);
		}
		if (clean) {
			evt = evt.remove(n => n.$once);
			if (evt.length)
				this.$events[name] = evt;
			else
				this.$events[name] = undefined;
		}
	}
	return this;
};

Binary.prototype.on = function(name, fn) {

	if (!fn.$once)
		this.db.$free = false;

	if (this.$events[name])
		this.$events[name].push(fn);
	else
		this.$events[name] = [fn];
	return this;
};

Binary.prototype.once = function(name, fn) {
	fn.$once = true;
	return this.on(name, fn);
};

Binary.prototype.removeListener = function(name, fn) {
	var evt = this.$events[name];
	if (evt) {
		evt = evt.remove(n => n === fn);
		if (evt.length)
			this.$events[name] = evt;
		else
			this.$events[name] = undefined;
	}
	return this;
};

Binary.prototype.removeAllListeners = function(name) {
	if (name === true)
		this.$events = EMPTYOBJECT;
	else if (name)
		this.$events[name] = undefined;
	else
		this.$events = {};
	return this;
};

Binary.prototype.insert = function(name, buffer, custom, callback) {

	var self = this;
	var type = framework_utils.getContentType(framework_utils.getExtension(name));

	if (buffer && !(buffer instanceof Buffer)) {
		if (typeof(buffer) === 'function') {
			callback = buffer;
			buffer = custom = null;
		} else if (!buffer.resume) {
			callback = custom;
			custom = buffer;
			buffer = null;
		}
	} else if (typeof(custom) === 'function') {
		callback = custom;
		custom = null;
	}

	if (!buffer) {
		var reader = Fs.createReadStream(name);
		CLEANUP(reader);
		return self.insertstream(null, framework_utils.getName(name), type, reader, callback, custom);
	}

	if (typeof(buffer) === 'string')
		buffer = framework_utils.createBuffer(buffer, 'base64');
	else if (buffer.resume)
		return self.insertstream(null, name, type, buffer, callback);

	var size = buffer.length;
	var dimension;
	var ext = framework_utils.getExtension(name);

	switch (ext) {
		case 'gif':
			dimension = framework_image.measureGIF(buffer);
			break;
		case 'png':
			dimension = framework_image.measurePNG(buffer);
			break;
		case 'jpg':
		case 'jpeg':
			dimension = framework_image.measureJPG(buffer);
			break;
		case 'svg':
			dimension = framework_image.measureSVG(buffer);
			break;
	}

	var time = NOW.format('yyyyMMdd');
	var h = { name: name, size: size, type: type, date: time };

	if (custom)
		h.custom = custom;

	if (dimension) {
		if (dimension.width)
			h.width = dimension.width;

		if (dimension.height)
			h.height = dimension.height;
	}

	var header = framework_utils.createBufferSize(BINARY_HEADER_LENGTH);
	header.fill(' ');
	header.write(JSON.stringify(h));

	var id;

	if (self.meta.free.length) {
		id = self.meta.free.shift();
	} else {
		self.meta.index++;
		id = self.meta.index;
	}

	self.meta.count++;

	var path = self.$directory(id);
	self.check(path);
	self.$save();

	var filename = id.toString().padLeft(DIRECTORYLENGTH, '0');
	var stream = Fs.createWriteStream(Path.join(path, filename + self.ext));

	stream.write(header, 'binary');
	stream.end(buffer);
	CLEANUP(stream);

	id = 'B' + time + 'T' + filename;
	callback && callback(null, id, h);
	self.$events.insert && self.emit('insert', id, h);

	return id;
};

Binary.prototype.insertstream = function(id, name, type, stream, callback, custom) {

	var self = this;
	var time = NOW.format('yyyyMMdd');
	var h = { name: name, size: 0, type: type, date: time };

	if (custom)
		h.custom = custom;

	var header = framework_utils.createBufferSize(BINARY_HEADER_LENGTH);

	header.fill(' ');
	header.write(JSON.stringify(h));

	var isnew = false;
	var cacheid = id;

	if (id) {
		// check if it's new implementation
		if (id > 0) {
			isnew = true;
		} else if (id[0] === 'B' || id[0] === 'b') {
			isnew = true;
			id = +id.substring(id.length - DIRECTORYLENGTH);
		}
	} else {
		isnew = true;
		if (self.meta.free.length) {
			id = self.meta.free.shift();
		} else {
			self.meta.index++;
			id = self.meta.index;
		}
		self.meta.count++;
		self.$save();
	}

	var filepath;
	var filename;

	if (isnew) {
		var path = self.$directory(id);
		self.check(path);
		filename = id.toString().padLeft(DIRECTORYLENGTH, '0');
		filepath = Path.join(path, filename + self.ext);
	} else
		filepath = framework_utils.join(self.directory, self.db.name + '#' + id + self.ext);

	var writer = Fs.createWriteStream(filepath);
	writer.write(header, 'binary');

	var ext = framework_utils.getExtension(name);
	var dimension = null;

	IMAGES[ext] && stream.once('data', function(buffer) {
		switch (ext) {
			case 'gif':
				dimension = framework_image.measureGIF(buffer);
				break;
			case 'png':
				dimension = framework_image.measurePNG(buffer);
				break;
			case 'jpg':
			case 'jpeg':
				dimension = framework_image.measureJPG(buffer);
				break;
			case 'svg':
				dimension = framework_image.measureSVG(buffer);
				break;
		}
	});

	stream.pipe(writer);

	if (isnew)
		id = 'B' + time + 'T' + filename;

	CLEANUP(writer, function() {

		if (dimension) {
			if (dimension.width)
				h.width = dimension.width;
			if (dimension.height)
				h.height = dimension.height;
		}

		h.size = writer.bytesWritten;

		Fs.open(filepath, 'a', function(err, fd) {
			if (!err) {
				var header = framework_utils.createBufferSize(BINARY_HEADER_LENGTH);
				header.fill(' ');
				header.write(JSON.stringify(h));
				Fs.write(fd, header, 0, header.length, 0, () => Fs.close(fd, NOOP));
			}
		});

		callback && callback(null, cacheid || id, h);
		self.$events.insert && self.emit('insert', cacheid || id, h);
	});

	return cacheid || id;
};

Binary.prototype.update = function(id, name, buffer, custom, callback) {

	var type = framework_utils.getContentType(framework_utils.getExtension(name));
	var self = this;
	var isfn = typeof(buffer) === 'function';

	if (buffer && !(buffer instanceof Buffer)) {
		if (typeof(buffer) === 'function') {
			callback = buffer;
			buffer = custom = null;
		} else if (!buffer.resume) {
			callback = custom;
			custom = buffer;
			buffer = null;
		}
	} else if (typeof(custom) === 'function') {
		callback = custom;
		custom = null;
	}

	if (!buffer) {

		if (isfn) {
			callback = buffer;
			buffer = undefined;
		}

		var reader = Fs.createReadStream(name);
		CLEANUP(reader);
		return self.insertstream(id, framework_utils.getName(name), type, reader, callback, custom);
	}

	if (typeof(buffer) === 'string')
		buffer = framework_utils.createBuffer(buffer, 'base64');

	if (buffer.resume)
		return self.insertstream(id, name, type, buffer, callback);

	var isnew = false;
	var time = NOW.format('yyyyMMdd');
	var size = buffer.length;
	var ext = framework_utils.getExtension(name);
	var dimension;
	var filepath;
	var filename;
	var cacheid = id;

	// check if it's new implementation
	if (id > 0)
		isnew = true;
	else if (id[0] === 'B' || id[0] === 'b') {
		isnew = true;
		id = +id.substring(id.length - DIRECTORYLENGTH);
	}

	if (isnew) {
		var path = self.$directory(id);
		self.check(path);
		filename = id.toString().padLeft(DIRECTORYLENGTH, '0');
		filepath = Path.join(path, filename + self.ext);
	} else {
		self.check();
		filepath = framework_utils.join(self.directory, self.db.name + '#' + id + self.ext);
	}

	switch (ext) {
		case 'gif':
			dimension = framework_image.measureGIF(buffer);
			break;
		case 'png':
			dimension = framework_image.measurePNG(buffer);
			break;
		case 'jpg':
		case 'jpeg':
			dimension = framework_image.measureJPG(buffer);
			break;
		case 'svg':
			dimension = framework_image.measureSVG(buffer);
			break;
	}

	var h = { name: name, size: size, type: type, date: time };

	if (custom)
		h.custom = custom;

	if (dimension) {
		if (dimension.width)
			h.width = dimension.width;

		if (dimension.height)
			h.height = dimension.height;
	}

	var header = framework_utils.createBufferSize(BINARY_HEADER_LENGTH);

	header.fill(' ');
	header.write(JSON.stringify(h));

	var stream = Fs.createWriteStream(filepath);
	stream.write(header, 'binary');
	stream.end(buffer);
	CLEANUP(stream);
	callback && callback(null, cacheid, h);
	self.$events.insert && self.emit('insert', cacheid, h);
	return cacheid;
};

Binary.prototype.read = function(id, callback, count) {

	var self = this;

	if (count > 3) {
		callback(new Error('File not found.'));
		return self;
	}

	var isnew = false;

	if (id > 0)
		isnew = true;
	else if (id[0] === 'B' || id[0] === 'b') {
		id = +id.substring(id.length - DIRECTORYLENGTH);
		isnew = true;
	} else if (id.indexOf('#') === -1)
		id = self.db.name + '#' + id;

	var filename;

	if (isnew) {
		filename = Path.join(self.$directory(id), id.toString().padLeft(DIRECTORYLENGTH, '0') + self.ext);
	} else
		filename = framework_utils.join(self.directory, id + self.ext);

	var stream = Fs.createReadStream(filename, BINARYREADMETA);
	stream.on('error', err => callback(err));
	stream.on('data', function(buffer) {
		var json = buffer.toString('utf8').replace(REGCLEAN, '');
		if (json) {
			var meta = JSON.parse(json, jsonparser);
			stream = Fs.createReadStream(filename, BINARYREADDATA);
			callback(null, stream, meta);
			CLEANUP(stream);
		} else
			setTimeout(readfileattempt, 100, self, id, callback, count || 1);
	});

	return self;
};

Binary.prototype.readbase64 = function(id, callback, count) {

	var self = this;

	if (count > 3) {
		callback(new Error('File not found.'));
		return self;
	}

	var isnew = false;

	if (id > 0)
		isnew = true;
	else if (id[0] === 'B' || id[0] === 'b') {
		id = +id.substring(id.length - DIRECTORYLENGTH);
		isnew = true;
	} else if (id.indexOf('#') === -1)
		id = self.db.name + '#' + id;

	var filename;

	if (isnew) {
		filename = Path.join(self.$directory(id), id.toString().padLeft(DIRECTORYLENGTH, '0') + self.ext);
	} else
		filename = framework_utils.join(self.directory, id + self.ext);

	var stream = Fs.createReadStream(filename, BINARYREADMETA);
	stream.on('error', err => callback(err));
	stream.on('data', function(buffer) {
		var json = buffer.toString('utf8').replace(REGCLEAN, '');
		if (json) {
			var meta = JSON.parse(json, jsonparser);
			stream = Fs.createReadStream(filename, BINARYREADDATABASE64);
			callback(null, stream, meta);
			CLEANUP(stream);
		} else
			setTimeout(readfileattempt, 100, self, id, callback, count || 1);
	});

	return self;
};


function readfileattempt(self, id, callback, count) {
	self.read(id, callback, count + 1);
}

Binary.prototype.remove = function(id, callback) {

	var self = this;
	var cacheid = id;
	var isnew = false;
	var filename;

	if (id > 0)
		isnew = true;
	else if (id[0] === 'B' || id[0] === 'b') {
		isnew = true;
		id = +id.substring(id.length - DIRECTORYLENGTH);
	} else if (id.indexOf('#') === -1)
		id = self.db.name + '#' + id;

	if (isnew) {
		var path = self.$directory(id);
		filename = Path.join(path, id.toString().padLeft(DIRECTORYLENGTH, '0') + self.ext);
	} else
		filename = framework_utils.join(self.directory, id + self.ext);

	Fs.unlink(filename, function(err) {

		if (isnew && !err) {
			self.meta.count--;
			self.meta.free.push(id);
			self.$save();
		}

		callback && callback(null, err ? false : true);
	});

	self.$events.remove && self.emit('remove', cacheid);
	return self;
};

Binary.prototype.check = function(path) {

	var self = this;
	var key = self.cachekey + (path == null ? 'root' : path.substring(path.length - (DIRECTORYLENGTH + 2)));

	if (F.temporary.other[key])
		return self;

	if (path != null && !F.temporary.other[self.cachekey + 'root'])
		self.check();

	F.temporary.other[key] = true;

	try {
		Fs.mkdirSync(path ? path : self.directory);
	} catch (err) {}

	return self;
};

Binary.prototype.clear = function(callback) {

	var self = this;

	Fs.readdir(self.directory, function(err, response) {

		if (err)
			return callback(err);

		var pending = [];
		var directories =[];
		var key = self.db.name + '#';
		var l = key.length;
		var target = framework_utils.join(self.directory);

		for (var i = 0, length = response.length; i < length; i++) {
			var p = response[i];
			if (p.substring(0, l) === key)
				pending.push(target + '/' + p);
			else if (p[3] === '-' && p[7] === '-')
				directories.push(target + '/' + p);
		}

		pending.push(target + '/meta.json');
		self.$events.clear && self.emit('clear', pending.length);
		pending.length && F.unlink(pending, F.errorhandling);
		directories.wait(function(path, next) {
			Fs.readdir(path, function(err, files) {
				for (var i = 0; i < files.length; i++)
					files[i] = path + '/' + files[i];
				F.unlink(files, () => Fs.unlink(path, next));
			});
		}, callback);
	});

	return self;
};

Binary.prototype.browse = function(directory, callback) {
	var self = this;

	if (typeof(directory) === 'function') {
		Fs.readdir(self.directory, function(err, files) {
			var dirs = [];
			for (var i = 0; i < files.length; i++) {
				var p = files[i];
				if (p[3] === '-' && p[7] === '-')
					dirs.push(p);
			}
			directory(null, dirs);
		});
	} else {
		Fs.readdir(Path.join(self.directory, directory), function(err, response) {

			var target = framework_utils.join(self.directory, directory);
			var output = [];
			var le = self.ext.length;

			response.wait(function(item, next) {
				Fs.stat(target + '/' + item, function(err, stat) {

					if (err)
						return next();

					var stream = Fs.createReadStream(target + '/' + item, BINARYREADMETA);

					stream.on('data', function(buffer) {
						var json = framework_utils.createBuffer(buffer, 'binary').toString('utf8').replace(REGCLEAN, '').parseJSON(true);
						if (json) {
							var id = item.substring(0, item.length - le);
							json.id = 'B' + json.date + 'T' + id;
							json.index = +id.substring(id.length - DIRECTORYLENGTH);
							json.ctime = stat.ctime;
							json.mtime = stat.mtime;
							output.push(json);
						}
					});

					CLEANUP(stream, next);

				});

			}, () => callback(null, output), 2);

		});
	}

	return self;
};

Binary.prototype.all = function(callback) {
	var self = this;

	self.check();

	Fs.readdir(self.directory, function(err, response) {

		if (err)
			return callback(err, EMPTYARRAY);

		var pending = [];
		var key = self.db.name + '#';
		var l = key.length;

		for (var i = 0, length = response.length; i < length; i++)
			response[i].substring(0, l) === key && pending.push(response[i]);

		var target = framework_utils.join(self.directory);
		var output = [];
		var le = self.ext.length;

		pending.wait(function(item, next) {
			Fs.stat(target + '/' + item, function(err, stat) {

				if (err)
					return next();

				var stream = Fs.createReadStream(target + '/' + item, BINARYREADMETA);

				stream.on('data', function(buffer) {
					var json = framework_utils.createBuffer(buffer, 'binary').toString('utf8').replace(REGCLEAN, '').parseJSON(true);
					if (json) {
						json.id = item.substring(l, item.length - le);
						json.ctime = stat.ctime;
						json.mtime = stat.mtime;
						output.push(json);
					}
				});

				CLEANUP(stream, next);

			});

		}, function() {
			if (self.meta.count) {
				self.browse(function(err, directories) {
					directories.wait(function(item, next) {
						self.browse(item, function(err, files) {
							files.length && output.push.apply(output, files);
							next();
						});
					}, () => callback(null, output));
				});
			} else
				callback(null, output);
		}, 2);
	});

	return self;
};

function Storage(db, directory) {
	var t = this;
	t.db = db;
	t.directory = directory;
	t.pending = [];
	t.locked_writer = 0;
	t.locked_reader = false;
	t.exists = false;
	if (!FORK) {
		t.$mapreducefile = Path.join(db.directory, db.name + EXTENSION_MAPREDUCE);
		t.$mapreduce = [];
		t.refresh();
	}
}

const SP = Storage.prototype;

SP.refresh = function() {
	try {
		this.$mapreduce = Fs.readFileSync(this.$mapreducefile).toString('utf8').parseJSON(true);
	} catch (e) {}
	return this;
};

SP.check = function() {

	var self = this;
	if (self.exists)
		return self;

	self.exists = true;

	try {
		Fs.mkdirSync(self.directory);
	} catch (err) {}

	return self;
};

SP.insert = function(doc) {

	var self = this;

	if (doc == null) {
		if (self.pending.length) {
			var dt = NOW.format('yyyyMMdd');
			self.locked_reader = true;
			self.check();
			Fs.appendFile(self.db.filenameStorage.format(dt), self.pending.join(NEWLINE) + NEWLINE, function(err) {
				err && F.error(err, 'NoSQL storage insert: ' + self.db.name);
				self.locked_reader = false;
			});
			self.pending = [];
		}
		return self;
	}

	self.locked_reader = true;

	if (self.$mapreduce.length) {
		for (var i = 0, length = self.$mapreduce.length; i < length; i++) {
			var mr = self.$mapreduce[i];
			mr.ready && mr.reduce(doc, mr.repository);
		}
		self.$mapreducesave();
	}

	if (self.locked_writer) {
		self.pending.push(JSON.stringify(doc));
		return self;
	}

	self.check();
	self.locked_writer = true;
	Fs.appendFile(self.db.filenameStorage.format(NOW.format('yyyyMMdd')), JSON.stringify(doc) + NEWLINE, function(err) {
		self.locked_writer = false;
		self.locked_reader = false;
		self.pending.length && self.insert();
		err && F.error(err, 'NoSQL storage insert: ' + self.db.name);
	});

	return self;
};

SP.stats = function(name, fn) {
	if (fn == null) {
		var obj = {};
		for (var i = 0; i < this.$mapreduce.length; i++) {
			var item = this.$mapreduce[i];
			obj[item.name] = FORK ? item.repository : U.clone(item.repository);
		}
		name(null, obj);
	} else {
		var item = this.$mapreduce.findItem('name', name);
		fn(item ? null : new Error('Stats of MapReduce "{0}" not found.'.format(name)), item ? (FORK ? item.repository : CLONE(item.repository)) : null);
	}
	return this;
};

SP.mapreduce = function(name, fn, def) {

	var self = this;

	if (!self.$mapreduce)
		self.$mapreduce = [];

	var item = self.$mapreduce.findItem('name', name);

	if (item) {
		item.reduce = fn;
	} else {
		item = {};
		item.name = name;
		item.repository = def || {};
		item.reduce = fn;
		item.ready = false;
		self.$mapreduce.push(item);
	}

	// Scan storage for this new mapreduce record
	!item.ready && self.scan(item.reduce, function(err, repository) {
		item.repository = repository;
		item.ready = true;
		self.$mapreducesave();
	}, true);

	return self;
};

SP.$mapreducesave = function() {
	var self = this;
	Fs.writeFile(self.$mapreducefile, JSON.stringify(self.$mapreduce, (k, v) => k !== 'reduce' ? v : undefined), F.errorcallback);
	return self;
};

SP.listing = function(beg, end, callback) {

	var tmp;
	if (beg) {

		if (typeof(beg) === 'string') {
			beg = beg.toString().split('-');
			if (beg[1] && beg[1].length < 2)
				beg[1] = '0' + beg[1];
			if (beg[2] && beg[2].length < 2)
				beg[2] = '0' + beg[2];
			beg = +beg.join('');
		}

		tmp = beg.toString().length;
		if (tmp === 4)
			beg *= 10000;
		else if (tmp === 6)
			beg *= 100;
	}

	if (end) {

		if (typeof(end) === 'string') {
			end = end.toString().split('-');
			if (end[1] && end[1].length < 2)
				end[1] = '0' + end[1];
			if (end[2] && end[2].length < 2)
				end[2] = '0' + end[2];
			end = +end.join('');
		}

		tmp = end.toString().length;
		if (tmp === 4)
			end *= 10000;
		else if (tmp === 6)
			end *= 100;
	}

	var self = this;

	U.ls(self.directory, function(files) {
		var storage = [];
		for (var i = 0, length = files.length; i < length; i++) {
			var item = files[i];
			var skip = item.length - EXTENSION.length;
			var date = +item.substring(skip - 8, skip);
			if ((beg && beg > date) || (end && end < date))
				continue;
			storage.push({ filename: item, date: date });
		}
		callback(null, storage);
	}, (path, is) => is ? false : path.endsWith(EXTENSION));

	return self;
};

SP.scan = function(beg, end, mapreduce, callback, reverse) {
	var self = this;

	if (typeof(beg) === 'function') {
		reverse = mapreduce;
		mapreduce = beg;
		callback = end;
		beg = null;
		end = null;
	} else if (typeof(end) === 'function') {
		reverse = callback;
		callback = mapreduce;
		mapreduce = end;
		end = null;
	}

	if (typeof(callback) === 'boolean') {
		reverse = callback;
		callback = null;
	}

	self.listing(beg, end, function(err, storage) {

		var repository = {};
		var stats = {};

		// Desc
		storage.quicksort('date', reverse == true);

		stats.files = storage.length;
		stats.documents = 0;
		stats.duration = Date.now();
		stats.processed = 0;
		stats.canceled = false;

		var today = +NOW.format('yyyyMMdd');
		var process = function(item, next, index) {

			if (self.locked_read) {
				setTimeout(process, 100, item, next, index);
				return;
			}

			var reader = new NoSQLStream(item.filename);
			stats.current = item.date;
			stats.index = index;

			reader.ondocuments = function() {
				var docs = JSON.parse('[' + reader.docs + ']', jsonparser);
				for (var j = 0; j < docs.length; j++) {
					stats.documents++;
					var json = docs[j];
					var end = mapreduce(json, repository, stats) === false;
					if (end) {
						stats.canceled = true;
						return false;
					}
				}
			};

			reader.$callback = function() {
				stats.processed++;
				if (item.date === today) {
					self.locked_writer--;
					if (self.locked_writer <= 0 && self.pending.length)
						self.insert();
				}
				setImmediate(next);
			};

			reader.openread();
		};

		storage.wait(function(item, next, index) {
			if (stats.canceled) {
				setImmediate(next);
			} else {

				if (item.date === today) {
					if (self.locked_read) {
						setTimeout(process, 100, item, next, index);
						return;
					}
				}

				if (item.date === today)
					self.locked_writer++;

				process(item, next, index);
			}
		}, function() {
			stats.duration = Date.now() - stats.duration;
			callback && callback(null, repository, stats);
		});

	});

	return self;
};

SP.clear = function(beg, end, callback) {
	var self = this;

	if (typeof(beg) === 'function') {
		callback = end;
		beg = null;
		end = null;
	} else if (typeof(end) === 'function') {
		callback = end;
		end = null;
	}

	self.listing(beg, end, function(err, files) {

		var count = 0;

		var remove = function(filename, callback, attemp) {
			Fs.unlink(filename, function(err) {
				if (err) {
					if (err.toString().indexOf('no such file') === -1) {
						if (attemp > 5)
							callback();
						else
							setTimeout(() => remove(filename, callback, (attemp || 0) + 1), 100);
					} else
						callback();
				} else {
					count++;
					callback();
				}
			});
		};

		files.wait((item, next) => remove(item.filename, next), function() {
			remove(self.$mapreducefile, () => callback && callback(null, count));
		});

	});
	return self;
};

function Backuper(filename) {
	this.filename = filename;
	this.items = [];
	this.is = false;
	this.callback;
}

Backuper.prototype.write = function(value) {
	this.items.push(value);
	this.flush();
	return this;
};

Backuper.prototype.flush = function() {
	var self = this;

	if (self.is)
		return self;

	if (!self.items.length)
		return self;

	var value = self.items.join('');
	self.is = true;

	Fs.appendFile(self.filename, value, function() {
		self.is = false;
		self.flush();
	});

	self.items = [];
	return self;
};

TP.ready = function(fn) {
	var self = this;
	if (self.ready)
		fn.call(self);
	else {
		setTimeout(function(self, fn) {
			self.ready(fn);
		}, 100, self, fn);
	}
	return self;
};

TP.insert = function(doc, unique) {

	var self = this;
	var builder;

	self.readonly && self.throwReadonly();

	if (unique) {

		builder = self.one();
		var callback;

		builder.callback(function(err, d) {
			if (d)
				callback && callback(null, 0);
			else
				self.insert(doc).callback(callback);
		});

		builder.callback = function(fn) {
			callback = fn;
			return builder;
		};

		return builder;
	}

	builder = new DatabaseBuilder2(self);
	self.pending_append.push({ doc: doc, builder: builder });
	setImmediate(next_operation, self, 1);
	self.$events.insert && self.emit('insert', doc);
	return builder;
};

TP.update = function(doc, insert) {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	self.pending_update.push({ builder: builder, doc: doc, count: 0, insert: insert === true ? doc : insert });
	setImmediate(next_operation, self, 2);
	return builder;
};

TP.modify = function(doc, insert) {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	var data = framework_builders.isSchema(doc) ? doc.$clean() : doc;
	var keys = Object.keys(data);
	if (keys.length) {
		var inc = null;
		for (var i = 0; i < keys.length; i++) {
			var key = keys[i];
			switch (key[0]) {
				case '+':
				case '-':
				case '*':
				case '/':
					!inc && (inc = {});
					var tmp = key.substring(1);
					inc[tmp] = key[0];
					doc[tmp] = doc[key];
					doc[key] = undefined;
					keys[i] = tmp;
					break;
			}
		}
		self.pending_update.push({ builder: builder, doc: data, count: 0, keys: keys, inc: inc, insert: insert === true ? data : insert });
		setImmediate(next_operation, self, 2);
	}
	return builder;
};

TP.remove = function() {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	self.pending_remove.push({ builder: builder, count: 0 });
	setImmediate(next_operation, self, 3);
	return builder;
};

TP.listing = function(builder) {
	var self = this;
	self.readonly && self.throwReadonly();
	if (builder)
		builder.db = self;
	else
		builder = new DatabaseBuilder(self);
	builder.$options.listing = true;
	builder.$take = builder.$options.take = 100;
	self.pending_reader.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

TP.find = function(builder) {
	var self = this;
	self.readonly && self.throwReadonly();
	if (builder)
		builder.db = self;
	else
		builder = new DatabaseBuilder(self);
	self.pending_reader.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

TP.find2 = function(builder) {
	var self = this;
	if (builder)
		builder.db = self;
	else
		builder = new DatabaseBuilder(self);
	self.pending_reader2.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 11);
	return builder;
};

TP.stream = function(fn, repository, callback) {
	var self = this;
	self.readonly && self.throwReadonly();

	if (typeof(repository) === 'function') {
		callback = repository;
		repository = null;
	}

	self.pending_streamer.push({ fn: fn, callback: callback, repository: repository || {} });
	setImmediate(next_operation, self, 10);
	return self;
};

TP.extend = function(schema, callback) {
	var self = this;
	self.readonly && self.throwReadonly();
	self.lock(function(next) {

		var olds = self.$schema;
		var oldk = self.$keys;

		self.parseSchema(schema.replace(/;|,/g, '|').trim().split('|'));

		var meta = self.stringifySchema() + NEWLINE;
		var news = self.$schema;
		var newk = self.$keys;

		self.$schema = olds;
		self.$keys = oldk;

		var count = 0;
		var fs = new NoSQLStream(self.filename);
		var data = {};

		var tmp = self.filename + '-tmp';
		var writer = Fs.createWriteStream(tmp);

		writer.write(meta, 'utf8');
		writer.on('finish', function() {
			Fs.rename(tmp, self.filename, function() {
				next();
				callback && callback();
			});
		});

		data.keys = self.$keys;
		fs.divider = '\n';

		fs.ondocuments = function() {

			var lines = fs.docs.split(fs.divider);
			var items = [];

			self.$schema = olds;
			self.$keys = oldk;

			for (var a = count ? 0 : 1; a < lines.length; a++) {
				data.line = lines[a].split('|');
				data.index = count++;
				var doc = self.parseData(data);
				items.push(doc);
			}

			self.$schema = news;
			self.$keys = newk;

			var buffer = '';
			for (var i = 0; i < items.length; i++)
				buffer += self.stringify(items[i]) + NEWLINE;
			buffer && writer.write(buffer, 'utf8');
		};

		fs.$callback = function() {
			self.$schema = news;
			self.$keys = newk;
			writer.end();
			fs = null;
		};

		fs.openread();
	});

	return self;
};


TP.throwReadonly = function() {
	throw new Error('Table "{0}" doesn\'t contain any schema'.format(this.name));
};

TP.scalar = function(type, field) {
	return this.find().scalar(type, field);
};

TP.count = function() {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	self.pending_reader.push({ builder: builder, count: 0, type: 1 });
	setImmediate(next_operation, self, 4);
	return builder;
};

TP.one = function() {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	builder.first();
	self.pending_reader.push({ builder: builder, count: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

TP.top = function(max) {
	var self = this;
	self.readonly && self.throwReadonly();
	var builder = new DatabaseBuilder(self);
	builder.take(max);
	self.pending_reader.push({ builder: builder, count: 0, counter: 0 });
	setImmediate(next_operation, self, 4);
	return builder;
};

TP.next = function(type) {

	if (!this.ready || (type && NEXTWAIT[this.step]))
		return;

	if (!this.$writting && !this.$reading) {

		if (this.step !== 12 && this.pending_clear.length) {
			this.$clear();
			return;
		}

		if (this.step !== 13 && this.pending_clean.length) {
			this.$clean();
			return;
		}

		if (this.step !== 7 && !this.pending_reindex && this.pending_drops) {
			this.$drop();
			return;
		}

		if (this.step !== 14 && this.pending_locks.length) {
			this.$lock();
			return;
		}
	}

	if (!this.$writting) {

		if (this.step !== 1 && !this.pending_reindex && this.pending_append.length) {
			this.$append();
			return;
		}

		if (this.step !== 2 && !this.$writting && this.pending_update.length) {
			this.$update();
			return;
		}

		if (this.step !== 3 && !this.$writting && this.pending_remove.length) {
			this.$remove();
			return;
		}
	}

	if (!this.$reading) {

		if (this.step !== 4 && this.pending_reader.length) {
			this.$reader();
			return;
		}

		if (this.step !== 11 && this.pending_reader2.length) {
			this.$reader3();
			return;
		}

		if (this.step !== 10 && this.pending_streamer.length) {
			this.$streamer();
			return;
		}
	}

	if (this.step !== type) {
		this.step = 0;
		setImmediate(next_operation, this, 0);
	}
};

TP.$append = function() {
	var self = this;
	self.step = 1;

	if (!self.pending_append.length) {
		self.next(0);
		return;
	}

	self.$writting = true;

	self.pending_append.splice(0).limit(JSONBUFFER, function(items, next) {

		var data = '';

		for (var i = 0, length = items.length; i < length; i++)
			data += self.stringify(items[i].doc) + NEWLINE;

		Fs.appendFile(self.filename, data, function(err) {
			err && F.error(err, 'Table insert: ' + self.name);
			for (var i = 0, length = items.length; i < length; i++) {
				items[i].builder.$options.log && items[i].builder.log();
				var callback = items[i].builder.$callback;
				callback && callback(err, 1);
			}
			next();
		});

	}, () => setImmediate(next_append, self));
};

TP.$reader = function() {

	var self = this;

	self.step = 4;

	if (!self.pending_reader.length) {
		self.next(0);
		return self;
	}

	self.$reading = true;

	var filter = self.pending_reader.splice(0);
	var length = filter.length;
	var first = true;
	var indexer = 0;
	var keys = {};
	var keyscount = 0;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		if (!fil.builder.$options.first || fil.builder.$options.sort)
			first = false;
		if (fil.builder.$keys == null && keys)
			keys = null;
		else if (keys) {
			if (fil.builder.$options.fields) {
				for (var j = 0; j < fil.builder.$keys.length; j++) {
					keyscount++;
					keys[fil.builder.$keys[j]] = 1;
				}
			} else
				keys = null;
		}

		fil.scalarcount = 0;
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
	}

	if (first && length > 1)
		first = false;

	var fs = new NoSQLStream(self.filename);
	var data = {};

	fs.divider = '\n';
	data.keys = keys && keyscount ? Object.keys(keys) : self.$keys;

	fs.ondocuments = function() {

		var lines = fs.docs.split(fs.divider);
		var val;

		for (var j = indexer ? 0 : 1; j < lines.length; j++) {

			data.line = lines[j].split('|');
			data.index = indexer++;

			indexer++;

			var obj = self.parseData(data);

			for (var i = 0; i < length; i++) {
				var item = filter[i];
				var builder = item.builder;
				item.filter.index = indexer;

				var output = item.compare(obj, item.filter, indexer);
				if (!output)
					continue;

				item.count++;

				if (!builder.$inlinesort && ((builder.$options.skip && builder.$options.skip >= item.count) || (builder.$options.take && builder.$options.take <= item.counter)))
					continue;

				item.counter++;

				if (item.type)
					continue;

				switch (builder.$options.scalar) {
					case 'count':
						item.scalar = item.scalar ? item.scalar + 1 : 1;
						break;
					case 'sum':
						val = output[builder.$options.scalarfield] || 0;
						item.scalar = item.scalar ? item.scalar + val : val;
						break;
					case 'min':
						val = output[builder.$options.scalarfield] || 0;
						if (val != null) {
							if (item.scalar) {
								if (item.scalar > val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'max':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar) {
								if (item.scalar < val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'avg':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							item.scalar = item.scalar ? item.scalar + val : val;
							item.scalarcount++;
						}
						break;
					case 'group':
						!item.scalar && (item.scalar = {});
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar[val])
								item.scalar[val]++;
							else
								item.scalar[val] = 1;
						}
						break;
					default:
						if (builder.$inlinesort)
							nosqlinlinesorter(item, builder, output);
						else if (item.response)
							item.response.push(output);
						else
							item.response = [output];
						break;
				}

				if (first)
					return false;
			}
		}
	};

	fs.$callback = function() {
		for (var i = 0; i < length; i++) {
			var item = filter[i];
			var builder = item.builder;
			var output;

			if (builder.$options.scalar || !builder.$options.sort) {

				if (builder.$options.scalar)
					output = builder.$options.scalar === 'avg' ? item.scalar / item.scalarcount : item.scalar;
				else if (builder.$options.first)
					output = item.response ? item.response[0] : undefined;
				else if (builder.$options.listing)
					output = listing(builder, item);
				else
					output = item.response || [];

				builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
				continue;
			}

			if (item.count) {
				if (builder.$options.sort.name) {
					if (!builder.$inlinesort || builder.$options.take !== item.response.length)
						item.response.quicksort(builder.$options.sort.name, builder.$options.sort.asc);
				} else if (builder.$options.sort === null)
					item.response.random();
				else
					item.response.sort(builder.$options.sort);

				if (builder.$options.skip && builder.$options.take)
					item.response = item.response.splice(builder.$options.skip, builder.$options.take);
				else if (builder.$options.skip)
					item.response = item.response.splice(builder.$options.skip);
				else if (!builder.$inlinesort && builder.$options.take)
					item.response = item.response.splice(0, builder.$options.take);
			}

			if (builder.$options.first)
				output = item.response ? item.response[0] : undefined;
			else if (builder.$options.listing)
				output = listing(builder, item);
			else
				output = item.response || [];

			builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
			builder.done();
		}

		fs = null;
		self.$reading = false;
		self.next(0);
	};

	fs.openread();
	return self;
};

TP.$reader3 = function() {

	var self = this;

	self.step = 11;

	if (!self.pending_reader2.length) {
		self.next(0);
		return self;
	}

	self.$reading = true;

	var filter = self.pending_reader2.splice(0);
	var length = filter.length;
	var first = true;
	var indexer = 0;
	var keys = {};
	var keyscount = 0;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		if (!fil.builder.$options.first || fil.builder.$options.sort)
			first = false;
		if (fil.builder.$keys == null && keys)
			keys = null;
		else if (keys) {
			if (fil.builder.$options.fields) {
				for (var j = 0; j < fil.builder.$keys.length; j++) {
					keyscount++;
					keys[fil.builder.$keys[j]] = 1;
				}
			} else
				keys = null;
		}

		fil.scalarcount = 0;
		fil.compare = fil.builder.compile();
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
	}

	if (first && length > 1)
		first = false;

	var fs = new NoSQLStream(self.filename);
	var data = {};

	fs.divider = '\n';
	data.keys = keys && keyscount ? Object.keys(keys) : self.$keys;

	fs.ondocuments = function() {

		var lines = fs.docs.split(fs.divider);
		var val;

		for (var j = 0; j < lines.length; j++) {

			data.line = lines[j].split('|');

			if (!TABLERECORD[data.line[0]])
				continue;

			data.index = indexer++;
			indexer++;

			var obj = self.parseData(data);

			for (var i = 0; i < length; i++) {
				var item = filter[i];
				var builder = item.builder;
				item.filter.index = indexer;

				var output = item.compare(obj, item.filter, indexer);
				if (!output)
					continue;

				item.count++;

				if (!builder.$inlinesort && ((builder.$options.skip && builder.$options.skip >= item.count) || (builder.$options.take && builder.$options.take <= item.counter)))
					continue;

				item.counter++;

				if (item.type)
					continue;

				switch (builder.$options.scalar) {
					case 'count':
						item.scalar = item.scalar ? item.scalar + 1 : 1;
						break;
					case 'sum':
						val = output[builder.$options.scalarfield] || 0;
						item.scalar = item.scalar ? item.scalar + val : val;
						break;
					case 'min':
						val = output[builder.$options.scalarfield] || 0;
						if (val != null) {
							if (item.scalar) {
								if (item.scalar > val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'max':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar) {
								if (item.scalar < val)
									item.scalar = val;
							} else
								item.scalar = val;
						}
						break;
					case 'avg':
						val = output[builder.$options.scalarfield];
						if (val != null) {
							item.scalar = item.scalar ? item.scalar + val : val;
							item.scalarcount++;
						}
						break;
					case 'group':
						!item.scalar && (item.scalar = {});
						val = output[builder.$options.scalarfield];
						if (val != null) {
							if (item.scalar[val])
								item.scalar[val]++;
							else
								item.scalar[val] = 1;
						}
						break;
					default:
						if (builder.$inlinesort)
							nosqlinlinesorter(item, builder, output);
						else if (item.response)
							item.response.push(output);
						else
							item.response = [output];
						break;
				}

				if (first)
					return false;
			}
		}
	};

	fs.$callback = function() {

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			var builder = item.builder;
			var output;

			if (builder.$options.scalar || !builder.$options.sort) {

				if (builder.$options.scalar)
					output = builder.$options.scalar === 'avg' ? item.scalar / item.scalarcount : item.scalar;
				else if (builder.$options.first)
					output = item.response ? item.response[0] : undefined;
				else if (builder.$options.listing)
					output = listing(builder, item);
				else
					output = item.response || [];

				builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
				continue;
			}

			if (item.count) {
				if (builder.$options.sort.name) {
					if (!builder.$inlinesort || builder.$options.take !== item.response.length)
						item.response.quicksort(builder.$options.sort.name, builder.$options.sort.asc);
				} else if (builder.$options.sort === null)
					item.response.random();
				else
					item.response.sort(builder.$options.sort);

				if (builder.$options.skip && builder.$options.take)
					item.response = item.response.splice(builder.$options.skip, builder.$options.take);
				else if (builder.$options.skip)
					item.response = item.response.splice(builder.$options.skip);
				else if (!builder.$inlinesort && builder.$options.take)
					item.response = item.response.splice(0, builder.$options.take);
			}

			if (builder.$options.first)
				output = item.response ? item.response[0] : undefined;
			else if (builder.$options.listing)
				output = listing(builder, item);
			else
				output = item.response || [];

			builder.$callback2(errorhandling(null, builder, output), item.type === 1 ? item.count : output, item.count);
			builder.done();
		}

		self.$reading = false;
		fs = null;
		self.next(0);
	};

	fs.openreadreverse();
	return self;
};

TP.$update = function() {

	var self = this;
	self.step = 2;

	if (!self.pending_update.length) {
		self.next(0);
		return self;
	}

	self.$writting = true;

	var filter = self.pending_update.splice(0);
	var length = filter.length;
	var backup = false;
	var filters = 0;
	var change = false;
	var keys = {};
	var keyscount = 0;

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		fil.compare = fil.builder.compile(true);
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };

		if (fil.backup || fil.builder.$options.backup)
			backup = true;

		if (fil.builder.$keys == null)
			keys = null;
		else {
			for (var j = 0; j < fil.builder.$keys.length; j++) {
				keyscount++;
				keys[fil.builder.$keys[j]] = 1;
			}
		}

	}

	var indexer = 0;
	var fs = new NoSQLStream(self.filename);
	fs.divider = '\n';

	var data = {};
	data.keys = keys && keyscount ? Object.keys(keys) : self.$keys;

	fs.ondocuments = function() {

		var lines = fs.docs.split(fs.divider);
		var val;

		for (var a = indexer ? 0 : 1; a < lines.length; a++) {

			data.line = lines[a].split('|');
			data.index = indexer++;

			var doc = self.parseData(data);
			var is = false;
			var rec = fs.docsbuffer[a];

			for (var i = 0; i < length; i++) {

				var item = filter[i];
				if (item.skip)
					continue;

				item.filter.index = indexer;

				var output = item.compare(doc, item.filter, indexer);
				if (output) {

					if (item.filter.options.first) {
						item.skip = true;
						filters++;
					}

					if (data.keys !== self.$keys) {
						var tmp = data.keys;
						data.keys = self.$keys;
						output = self.parseData(data, output);
						data.keys = tmp;
					}

					var e = item.keys ? 'modify' : 'update';
					var old = self.$events[e] ? CLONE(output) : 0;

					if (item.keys) {
						for (var j = 0; j < item.keys.length; j++) {
							var key = item.keys[j];
							var val = item.doc[key];
							if (val !== undefined) {
								if (typeof(val) === 'function')
									output[key] = val(output[key], output);
								else if (item.inc && item.inc[key]) {
									switch (item.inc[key]) {
										case '+':
											output[key] = (output[key] || 0) + val;
											break;
										case '-':
											output[key] = (output[key] || 0) - val;
											break;
										case '*':
											output[key] = (output[key] || 0) + val;
											break;
										case '/':
											output[key] = (output[key] || 0) / val;
											break;
									}
								} else
									output[key] = val;
							}
						}
					} else
						output = typeof(item.doc) === 'function' ? item.doc(output) : item.doc;

					self.$events[e] && self.emit(e, output, old);
					item.count++;
					doc = output;
					is = true;
				}
			}

			if (is) {

				if (backup) {
					for (var i = 0; i < length; i++) {
						var item = filter[i];
						item.backup && item.backup.write(rec.doc + NEWLINE);
						item.builder.$options.backup && item.builder.$backupdoc(rec.doc);
					}
				}

				var upd = self.stringify(doc);
				if (upd === rec.doc)
					continue;

				var was = true;

				if (!change)
					change = true;

				if (rec.doc.length === upd.length) {
					var b = Buffer.byteLength(upd);
					if (rec.length === b) {
						fs.write(upd + NEWLINE, rec.position);
						was = false;
					}
				}

				if (was) {
					var tmp = fs.remchar + rec.doc.substring(1) + NEWLINE;
					fs.write(tmp, rec.position);
					fs.write2(upd + NEWLINE);
				}
			}

			if (filters === length)
				return false;
		}
	};

	fs.$callback = function() {

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			if (item.insert && !item.count) {
				item.builder.$insertcallback && item.builder.$insertcallback(item.insert);
				var tmp = self.insert(item.insert);
				tmp.$callback = item.builder.$callback;
				tmp.$options.log = item.builder.$options.log;
			} else {
				item.builder.$options.log && item.builder.log();
				item.builder.$callback && item.builder.$callback(errorhandling(null, item.builder, item.count), item.count, item.filter.repository);
			}
		}

		fs = null;
		self.$writting = false;
		self.next(0);

		change && self.$events.change && self.emit('change', 'update');
	};

	fs.openupdate();
	return self;
};

TP.$remove = function() {

	var self = this;
	self.step = 3;

	if (!self.pending_remove.length) {
		self.next(0);
		return;
	}

	self.$writting = true;

	var fs = new NoSQLStream(self.filename);
	var filter = self.pending_remove.splice(0);
	var length = filter.length;
	var change = false;
	var indexer = 0;
	var backup = false;
	var keys = {};
	var keyscount = 0;

	fs.divider = '\n';

	for (var i = 0; i < length; i++) {
		var fil = filter[i];
		fil.compare = fil.builder.compile(true);
		fil.filter = { repository: fil.builder.$repository, options: fil.builder.$options, arg: fil.builder.$params, fn: fil.builder.$functions };
		if (fil.backup || fil.builder.$options.backup)
			backup = true;
		if (fil.builder.$keys == null)
			keys = null;
		else {
			for (var j = 0; j < fil.builder.$keys.length; j++) {
				keyscount++;
				keys[fil.builder.$keys[j]] = 1;
			}
		}
	}

	var data = {};
	data.keys = keys && keyscount ? Object.keys(keys) : self.$keys;

	fs.ondocuments = function() {

		var lines = fs.docs.split(fs.divider);

		for (var a = indexer ? 0 : 1; a < lines.length; a++) {

			data.line = lines[a].split('|');
			data.index = indexer++;

			indexer++;
			var removed = false;
			var doc = self.parseData(data);
			var rec = fs.docsbuffer[a];

			for (var i = 0; i < length; i++) {
				var item = filter[i];
				item.filter.index = indexer;
				var output = item.compare(doc, item.filter, indexer);
				if (output) {
					removed = true;
					doc = output;
					break;
				}
			}

			if (removed) {

				if (backup) {
					for (var i = 0; i < length; i++) {
						var item = filter[i];
						item.backup && item.backup.write(rec.doc + NEWLINE);
						item.builder.$options.backup && item.builder.$backupdoc(rec.doc);
					}
				}

				if (!change)
					change = true;

				item.count++;
				self.$events.remove && self.emit('remove', doc);
				fs.write(fs.remchar + rec.doc.substring(1) + NEWLINE, rec.position);
			}
		}
	};

	fs.$callback = function() {

		for (var i = 0; i < length; i++) {
			var item = filter[i];
			item.builder.$options.log && item.builder.log();
			item.builder.$callback && item.builder.$callback(errorhandling(null, item.builder, item.count), item.count, item.filter.repository);
		}

		fs = null;
		self.$writting = false;
		self.next(0);
		change && self.$events.change && self.emit('change', 'remove');
	};

	fs.openupdate();
};

TP.$clean = function() {

	var self = this;
	self.step = 13;

	if (!self.pending_clean.length) {
		self.next(0);
		return;
	}

	var filter = self.pending_clean.splice(0);
	var length = filter.length;
	var now = Date.now();

	F.databasescleaner[self.name] = undefined;
	F.config['nosql-logger'] && PRINTLN('NoSQL Table "{0}" cleaning (beg)'.format(self.name));

	var fs = new NoSQLStream(self.filename);
	var writer = Fs.createWriteStream(self.filename + '-tmp');

	fs.divider = NEWLINE;

	fs.ondocuments = function() {
		writer.write(fs.docs + NEWLINE);
	};

	fs.$callback = function() {
		writer.end();
	};

	writer.on('finish', function() {
		Fs.rename(self.filename + '-tmp', self.filename, function() {
			F.config['nosql-logger'] && PRINTLN('NoSQL Table "{0}" cleaning (end, {1}s)'.format(self.name, (((Date.now() - now) / 1000) >> 0)));
			for (var i = 0; i < length; i++)
				filter[i]();
			self.$events.clean && self.emit('clean');
			self.next(0);
			fs = null;
		});
	});

	fs.openread();
};

TP.$clear = function() {

	var self = this;
	self.step = 12;

	if (!self.pending_clear.length) {
		self.next(0);
		return;
	}

	var filter = self.pending_clear.splice(0);
	Fs.unlink(self.filename, function() {
		for (var i = 0; i < filter.length; i++)
			filter[i]();

		Fs.appendFile(self.filename, self.stringifySchema() + NEWLINE, function() {
			self.$events.change && self.emit('change', 'clear');
			self.next(0);
		});
	});
};

TP.$lock = function() {

	var self = this;
	self.step = 14;

	if (!self.pending_locks.length) {
		self.next(0);
		return;
	}

	var filter = self.pending_locks.splice(0);
	filter.wait(function(fn, next) {
		fn.call(self, next);
	}, function() {
		self.next(0);
	});
};

TP.$streamer = function() {

	var self = this;
	self.step = 10;

	if (!self.pending_streamer.length) {
		self.next(0);
		return self;
	}

	self.$reading = true;

	var filter = self.pending_streamer.splice(0);
	var length = filter.length;
	var count = 0;
	var fs = new NoSQLStream(self.filename);
	var data = {};

	data.keys = self.$keys;
	fs.divider = '\n';

	fs.ondocuments = function() {
		var lines = fs.docs.split(fs.divider);
		for (var a = count ? 0 : 1; a < lines.length; a++) {
			data.line = lines[a].split('|');
			data.index = count++;
			var doc = self.parseData(data);
			for (var i = 0; i < length; i++)
				filter[i].fn(doc, filter[i].repository, count);
		}
	};

	fs.$callback = function() {
		for (var i = 0; i < length; i++)
			filter[i].callback && filter[i].callback(null, filter[i].repository, count);
		self.$reading = false;
		self.next(0);
		fs = null;
	};

	fs.openread();
	return self;
};

TP.parseSchema = function() {
	var self = this;
	var arr = arguments[0] instanceof Array ? arguments[0] : arguments;

	self.$schema = {};
	self.$keys = [];

	for (var i = 0; i < arr.length; i++) {
		var arg = arr[i].split(':');
		var type = 0;
		switch ((arg[1] || '').toLowerCase().trim()) {
			case 'number':
				type = 2;
				break;
			case 'boolean':
			case 'bool':
				type = 3;
				break;
			case 'date':
				type = 4;
				break;
			case 'object':
				type = 5;
				break;
			case 'string':
			default:
				type = 1;
				break;
		}
		var name = arg[0].trim();
		self.$schema[name] = { type: type, pos: i };
		self.$keys.push(name);
	}

	return self;
};

TP.stringifySchema = function() {

	var self = this;
	var data = [];

	for (var i = 0; i < self.$keys.length; i++) {

		var key = self.$keys[i];
		var meta = self.$schema[key];
		var type = 'string';

		switch (meta.type) {
			case 2:
				type = 'number';
				break;
			case 3:
				type = 'boolean';
				break;
			case 4:
				type = 'date';
				break;
			case 5:
				type = 'object';
				break;
		}

		data.push(key + ':' + type);
	}

	return data.join('|');
};

TP.parseData = function(data, cache) {

	var self = this;
	var obj = {};
	var esc = data.line[0] === '*';
	var val;

	for (var i = 0; i < data.keys.length; i++) {
		var key = data.keys[i];

		if (cache && cache[key] != null) {
			obj[key] = cache[key];
			continue;
		}

		var meta = self.$schema[key];
		if (meta == null)
			continue;

		var pos = meta.pos + 1;

		switch (meta.type) {
			case 1: // String
				obj[key] = data.line[pos];
				if (esc && obj[key])
					obj[key] = obj[key].replace(REGTUNESCAPE, regtescapereverse);
				break;
			case 2: // Number
				obj[key] = +data.line[pos];
				break;
			case 3: // Boolean
				val = data.line[pos];
				obj[key] = BOOLEAN[val] == 1;
				break;
			case 4: // Date
				val = data.line[pos];
				obj[key] = val ? new Date(val[10] === 'T' ? val : +val) : null;
				break;
			case 5: // Object
				val = data.line[pos];
				if (esc && val)
					val = val.replace(REGTUNESCAPE, regtescapereverse);
				obj[key] = val ? val.parseJSON(true) : null;
				break;
		}
	}
	return obj;
};

TP.stringify = function(doc) {

	var self = this;
	var output = '';
	var esc = false;

	for (var i = 0; i < self.$keys.length; i++) {
		var key = self.$keys[i];
		var meta = self.$schema[key];
		var val = doc[key];

		switch (meta.type) {
			case 1: // String
				val = val ? val : '';
				break;
			case 2: // Number
				val = (val || 0);
				break;
			case 3: // Boolean
				val = (val == true ? '1' : '0');
				break;
			case 4: // Date
				// val = val ? val.toISOString() : '';
				val = val ? val.getTime() : '';
				break;
			case 5: // Object
				val = val ? JSON.stringify(val) : '';
				break;
		}

		if (!esc && (meta.type === 1 || meta.type === 5)) {
			val += '';
			if (REGTESCAPETEST.test(val)) {
				esc = true;
				val = val.replace(REGTESCAPE, regtescape);
			}
		}

		output += '|' + val;
	}

	return (esc ? '*' : '+') + output;
};

function regtescapereverse(c) {
	switch (c) {
		case '%0A':
			return '\n';
		case '%0D':
			return '\r';
		case '%7C':
			return '|';
	}
	return c;
}

function regtescape(c) {
	switch (c) {
		case '\n':
			return '%0A';
		case '\r':
			return '%0D';
		case '|':
			return '%7C';
	}
	return c;
}

TP.free = function(force) {
	var self = this;
	if (!force && !self.$free)
		return self;
	self.removeAllListeners(true);
	delete F.databases['$' + self.name];
	return self;
};

// ======================================================
// Helper functions
// ======================================================

function compare_datetype(type, key, arg, operator) {

	// 0 doc
	// 1 arg
	// 2 operator
	// 3 type

	key = 'doc.' + key;
	arg = 'arg.' + arg;

	switch (operator) {
		case '=':
			operator = '==';
			break;
		case '<>':
			operator = '!=';
			break;
	}

	switch (type) {
		case 'day':
			type = 'getDate()';
			break;
		case 'month':
			type = 'getMonth()+1';
			break;
		case 'year':
			type = 'getFullYear()';
			break;
	}

	return '$is=false;$tmp={0};if($tmp){if(!$tmp.getTime){$tmp=new Date($tmp);if(isNaN($tmp))$tmp=0;}if($tmp)$is=($tmp.{3}){2}{1};}'.format(key, arg, operator, type);
}

function errorhandling(err, builder, response) {
	if (err)
		return err;
	var is = response instanceof Array;
	if (!response || (is && !response.length))
		return builder.$callback_emptyerror ? new ErrorBuilder().push(builder.$callback_emptyerror) : null;
	return null;
}

function jsonparser(key, value) {
	return typeof(value) === 'string' && value.isJSONDate() ? new Date(value) : value;
}