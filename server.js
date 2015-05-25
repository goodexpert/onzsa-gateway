#!/usr/bin/env node
'use strict';

var https = require('https')
  , http = require('http')
  , net = require('net')
  , WebSocketServer = require('websocket').server
  , SerialPort = require('serialport').SerialPort
  , fs = require('fs')
  , path = require('path')
  , port = process.argv[2] || 8443
  , insecurePort = process.argv[3] || 8080
  , server
  , insecureServer
  , options
  , certsPath = path.join(__dirname, 'certs', 'server')
  , caCertsPath = path.join(__dirname, 'certs', 'ca')
  ;

//
// SSL Certificates
//
options = {
  key: fs.readFileSync(path.join(certsPath, 'my-server.key.pem'))
, ca: [ fs.readFileSync(path.join(caCertsPath, 'my-root-ca.crt.pem')) ]
, cert: fs.readFileSync(path.join(certsPath, 'my-server.crt.pem'))
, requestCert: false
, rejectUnauthorized: false
};

function app(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello, Onzsa!');
}

//
// Serve an Express App securely with HTTPS
//
server = https.createServer(options);

server.listen(port, function () {
});

var wss = new WebSocketServer({
    httpServer: server
});

wss.on('request', function (request) {
    var protocols = request.requestedProtocols;

    if (protocols[0] != 'dps-gateway' && protocols[0] != 'cas-pd-ii-scale') {
        request.reject(404, 'Dosen\'t support protocol.');
        return;
    }

    var connection = request.accept(protocols[0], request.origin);

    console.log(connection.remoteAddress + " connected - Protocol Version " + connection.webSocketVersion);

    if (protocols[0] == 'dps-gateway') {
        dpsGateway(connection);
    } else if (protocols[0] == 'cas-pd-ii-scale') {
        casPdIIScale(connection);
    }
});

var dpsGateway = function(connection) {
    //
    // DPS configurations
    //
    var config = {
        // account number.
        accountNumber: 1,

        // hostname or ip address.
        hostname: '127.0.0.1',

        // port number.
        portNumber: 65,

        // The number of milliseconds to wait after sending a close frame
        // for an acknowledgement to come back before giving up and just
        // closing the socket.
        closeTimeout: 5000
    };

    var socket = net.Socket();
    socket.connect(config.portNumber, config.hostname, function() {
        console.log('connected dps client');
    });
    socket.setEncoding('utf-8'); /* utf8, utf16le, ucs2, ascii, hex */

    socket.on('error', function (error) {
        console.log(error.toString());
        // Don't persist this socket if there is a connection error
        socket.destroy();
    });

    // Handle closed connections by dps
    socket.on('close', function (had_error) {
        console.log('connection closed by dps');
    });

    // Handle incoming messages from socket
    socket.on('data', function (data) {
        connection.sendUTF(data);
    });

    // Handle closed connections by client
    connection.on('close', function (connection) {
        console.log('connection closed by client');
        socket.end();
    });

    // Handle incoming messages from client
    connection.on('message', function (message) {
        socket.write(message.utf8Data);
    });
};

var casPdIIScale = function(connection) {
    //
    // DPS configurations
    //
    var config = {
        baudrate: 9600,
        databits: 8,
        stopbits: 1,
        parity: 'none'
    };

    var serialPort = new SerialPort('\\\\.\\COM1', config, false);

    // Handle open event from serial port
    serialPort.open(function(error) {
        connection.sendUTF(JSON.stringify({
            msg: 'open',
            error: error
        }));
    });

    // Handle incoming messages from client
    serialPort.on('data', function (data) {
        var temp = new Buffer(data, 'utf8');
        console.log('received data from scale: ' + temp.toString());

        connection.sendUTF(JSON.stringify({
            msg: 'data',
            data: temp
        }));
    });

    // Handle closed connections by client
    connection.on('close', function (connection) {
        console.log('connection closed by client');
        serialPort.close();
    });

    // Handle incoming messages from client
    connection.on('message', function (message) {
        if (message.type === 'utf8') {
            var command = JSON.parse(message.utf8Data);
            if (command.msg == 'read') {
                serialPort.write(new Buffer("05", "hex"), function (err, results) {
                });
            }
        }
    });
};

//
// Redirect HTTP ot HTTPS
//
// This simply redirects from the current insecure location to the encrypted location
//
insecureServer = http.createServer();

insecureServer.on('request', function (req, res) {
  // TODO also redirect websocket upgrades
  res.setHeader(
    'Location'
  , 'https://' + req.headers.host.replace(/:\d+/, ':' + port) + req.url
  );
  res.statusCode = 302;
  res.end();
});

insecureServer.listen(insecurePort, function(){
  console.log("\nRedirecting all http traffic to https\n");
});

