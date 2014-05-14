var gracenode = require('../../');
var log = gracenode.log.create('server-response');
var zlib = require('zlib');

module.exports.create = function (server, request, response, startTime) {
	return new Response(server, request, response, startTime);
};

function Response(server, request, response, startTime) {
	this._server = server;
	this._request = request;
	this._response = response;
	this._startTime = startTime;
	this._defaultStatus = 200;
}

Response.prototype.header = function (name, value) {
	this._response.setHeader(name, value);
};

Response.prototype.json = function (content, status) {
	log.verbose('response content type: JSON');
	setupFinish(this._request, this._response, this._server, this._startTime);
	respondJSON(this._request, this._response, content, status || this._defaultStatus);
	finish(this._request, this._response, this._server);
};

Response.prototype.html = function (content, status) {
	log.verbose('response content type: HTML');
	setupFinish(this._request, this._response, this._server, this._startTime);
	respondHTML(this._request, this._response, content, status || this._defaultStatus);
	finish(this._request, this._response, this._server);
};

Response.prototype.data = function (content, status) {
	log.verbose('response content type: Data');
	setupFinish(this._request, this._response, this._server, this._startTime);
	respondData(this._request, this._response, content, status || this._defaultStatus);
	finish(this._request, this._response, this._server);
};

Response.prototype.file = function (content, status) {
	log.verbose('response content type: File');
	setupFinish(this._request, this._response, this._server, this._startTime);
	respondFILE(this._request, this._response, content, status || this._defaultStatus);
	finish(this._request, this._response, this._server);
};

Response.prototype.error = function (content, status) {
	this._errorHandler(content, status);
};

Response.prototype.redirect = function (content) {
	log.verbose('response content type: Redirect');
	setupFinish(this._request, this._response, this._server, this._startTime);
	respondRedirect(this._request, this._response, content);
	finish(this._request, this._response, this._server);
};

// internal use only
Response.prototype._setDefaultStatus = function (status) {
	this._defaultStatus = status;
};

// overrriden by controller
Response.prototype._errorHandler = function () {

};

Response.prototype._error = function (content, status) {
	log.verbose('response content type: Error');
	log.error('(url:' + this._request.url + ')', content);
	setupFinish(this._request, this._response, this._server, this._startTime);
	respondERROR(this._request, this._response, content, status);
	finish(this._request, this._response, this._server);
};

// sets up events for response finish. The events will be called when the request response has all been sent.
function setupFinish(req, res, server, startTime) {
	// this will be called when the server sends the response data and finishes it.
	res.once('finish', function () {
		var execTime = Date.now() - startTime;
		log.info('request execution time: (url:' + req.url + ') (took:' + execTime + 'ms)');
		server.emit('requestFinish', req.url, execTime);
	});
}

function finish(req, res, server) {
	res.emit('end', req.url);
	// this will be called when the server finishes all operation (not when the response data sent)
	server.emit('requestEnd', req.url);
}

function compressContent(req, content, cb) {
	if (content instanceof Buffer) {
		// we do not compress binary
		log.verbose('skip compressing binary data: (url:' + req.url + ') ' + (content.length / 1024) + 'KB');
		cb(null, content);
	}
	zlib.gzip(content, function (error, compressedData) {
		if (error) {
			return cb(error);
		}
		log.info('compressed content size: (url:' + req.url + ') ' + (compressedData.length / 1024) + ' KB');

		cb(null, compressedData);
	});
}

function respondJSON(req, res, content, status) {
	content = content || null;
	compressContent(req, JSON.stringify(content), function (error, data) {
		
		if (error) {
			log.error('compression error: (url:' + req.url, + ')', error);
			status = 500;
			data = error;
		}

		res.writeHead(status, {
			'Cache-Control': 'no-cache, must-revalidate',
			'Connection': 'Keep-Alive',
			'Content-Encoding': 'gzip',
			'Content-Type': 'text/plain; charset=UTF-8',
			'Pragma': 'no-cache',
			'Vary': 'Accept-Encoding',
			'Content-Length': data.length
		});

		responseLog(req, status);		

		res.end(data, 'binary');		

	});

}

function respondHTML(req, res, content, status) {
	content = content || null;
	compressContent(req, content, function (error, data) {
		
		if (error) {
			log.error('compression error: (url:' + req.url, + ')', error);
			status = 500;
			data = error;
		}

		res.writeHead(status, {
			'Cache-Control': 'no-cache, must-revalidate',
			'Connection': 'Keep-Alive',
			'Content-Encoding': 'gzip',
			'Content-Type': 'text/html; charset=UTF-8',
			'Pragma': 'no-cache',
			'Vary': 'Accept-Encoding',
			'Content-Length': data.length
		});

		responseLog(req, status);		

		res.end(data, 'binary');		

	});
}

function respondData(req, res, content, status) {
	content = content || null;
	compressContent(req, content, function (error, data) {
		
		if (error) {
			log.error('compression error: (url:' + req.url + ')', error);
			status = 500;
			data = error;
		}

		res.writeHead(status, {
			'Cache-Control': 'no-cache, must-revalidate',
			'Connection': 'Keep-Alive',
			'Content-Encoding': 'gzip',
			'Content-Type': 'text/plain; charset=UTF-8',
			'Pragma': 'no-cache',
			'Vary': 'Accept-Encoding',
			'Content-Length': data.length
		});

		responseLog(req, status);		

		res.end(data, 'binary');		

	});
}

function respondRedirect(req, res, content) {
	content = content || null;
	var status = 301;
	// content needs to be redirect URL
	res.writeHead(status, {
		Location: content
	});
	
	log.verbose('redirect to: ', content);

	responseLog(req, status);

	res.end();
}

function respondFILE(req, res, content, status) {
	content = content || null;
	var type = req.url.substring(req.url.lastIndexOf('.') + 1);
	var contentSize = content.length;
	res.writeHead(status, {
		'Content-Length': contentSize,
		'Content-Type': getFileType(type)
	});
	
	log.verbose('response content size: (url:' + req.url + ') ' + (contentSize / 1024) + ' KB');

	responseLog(req, status);		

	res.end(content, 'binary');

}

function respondERROR(req, res, content, status) {
	content = content || null;
	if (content !== null && typeof content === 'object') {
		content = JSON.stringify(content);
	}
	status = status || 400;
	compressContent(req, content, function (error, data) {
		
		if (error) {
			log.error('(url:' + req.url + ')', error);
			status = 500;
			data = error;
		}

		var contentSize = data.length;
		res.writeHead(status, {
			'Cache-Control': 'no-cache, must-revalidate',
			'Connection': 'Keep-Alive',
			'Content-Encoding': 'gzip',
			'Content-Type': 'text/plain; charset=UTF-8',
			'Pragma': 'no-cache',
			'Vary': 'Accept-Encoding',
			'Content-Length': data.length
		});
		
		log.error('response content size: (url:' + req.url + ') ' + (contentSize / 1024) + ' KB');
	
		responseLog(req, status);		
	
		res.end(data, 'binary');

	});
}

function responseLog(req, status) {
	var msg = 'response: (url:' + req.url + ') (status:' + status + ')';
	if (status >= 400) {
		log.error(msg);
	} else {
		log.info(msg);
	}
}

function getFileType(type) {
	switch (type) {
		case 'png':
		case 'gif':
			return 'image/' + type;
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'mp3':
			return 'audio/mpeg';
		case 'wav':
			return 'audio/wav';
		case 'ogg':
			return 'application/ogg';
		case 'oga':
		case 'ogv':
			return 'audio/ogg';
		case 'midi':
			return 'audio/midi';
		case 'pdf':
			return 'application/pdf';
		case 'mpeg4':
		case 'mpeg2':
			return 'video/mpeg';
		case 'css':
			return 'text/css';
		case 'js':
			return 'text/javascript';
		case 'html':
			return 'text/html';
		case 'xml':
			return 'text/xml';
		default:
			return 'text/plain';	
	}
}
