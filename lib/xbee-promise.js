/*
 * lib/xbee-promise.js
 * https://github.com/101100/xbee-promise
 *
 * Copyright (c) 2014 Jason Heard
 * Copyright 2014 ProdataKey, LLC.
 * Licensed under the MIT license.
 */
'use strict';

var parambulator = require('parambulator'),
    assert = require('assert'),
    Bluebird = require('bluebird'),
    _ = require('lodash'),
    serial = require('serialport'),
    xbee_api = require('xbee-api'),
    debug = require('debug')('xbee'),
    util = require('util');

module.exports = function xbeePromiseLibrary(options) {
  var xbeeAPI,
      serialport,
      cachedNodes = {},
      defaultTimeoutMs,
      module;


  function closeSerialport() {
    debug('Closing serial port');

    serialport.drain(function closeAfterDraining() {
      serialport.close();
    });
  }


  // Returns a promise that will resolve to the response for the given
  // frame that will be sent.
  function _sendFramePromiseResponse(frame, timeoutMs, responseFrameType) {
    var callback;

    return new Bluebird(function(resolve, reject) {
      // Set the frame ID 
      frame.id = xbeeAPI.nextFrameId();

      debug('_sendFramePromiseResponse', xbee_api.constants.FRAME_TYPE[frame.type], xbee_api.constants.FRAME_TYPE[responseFrameType], frame.id);

      // Create the callback to check for the response frame
      callback = function resolverCallback(receivedFrame) {
        debug('_sendFramePromiseResponse callback [%s] == [%s] && %d == %d', xbee_api.constants.FRAME_TYPE[receivedFrame.type], xbee_api.constants.FRAME_TYPE[responseFrameType], frame.id, receivedFrame.id);
        if (receivedFrame.id === frame.id && receivedFrame.type === responseFrameType) {
          debug('response matched request frame, resolve');
          // This is our frame's response. Resolve the promise.
          resolve(receivedFrame);
        }
      };
      
      // Attach callback so we're waiting for the response
      xbeeAPI.on('frame_object', callback);

      // Write to the serialport (when open or now if open)
      if (serialport.paused) {
        serialport.once('open', function () {
          serialport.write(xbeeAPI.buildFrame(frame));
        });
      } else {
        serialport.write(xbeeAPI.buildFrame(frame));
      }
    })
    // Return our promise with a timeout
    .timeout(timeoutMs)
    .finally(function() {
      // clean up: remove listener after the promise is complete (for any reason)
      xbeeAPI.removeListener('frame_object', callback);
    });
  }


  function _localCommand(command, timeoutMs, commandParameter) {
    var frame = {
          type: xbee_api.constants.FRAME_TYPE.AT_COMMAND,
          command: command,
          commandParameter: commandParameter
        };

    debug('Doing local command %s with parameter %s', command, commandParameter || []);

    return _sendFramePromiseResponse(frame, timeoutMs, xbee_api.constants.FRAME_TYPE.AT_COMMAND_RESPONSE)
      .then(function (frame) {
        assert(frame.commandStatus !== undefined);
        if (frame.commandStatus === xbee_api.constants.COMMAND_STATUS.OK) {
          debug('local %s command resolved with success', command);
          return frame.commandData;
        }

        // if not OK, throw error
        debug('local %s command resolved with failure: %s', frame.commandStatus);
        throw new Error(xbee_api.constants.COMMAND_STATUS[frame.commandStatus]);
      });
  }


  function _extractDestination64(commandData) {
    debug('_extractDestination64', commandData);
    // Result in commandData is 16 bit address as two bytes,
    // followed by 64 bit address as 8 bytes.  This function
    // returns the 64 bit address.
    var address64 = commandData.slice(2).toString('hex');

    debug('Extracted 64 bit address: %s', address64);

    return address64;
  }


  // Returns a promise that will resolve to the 64 bit address of the node
  // with the given node identifier.
  function _lookupByNodeIdentifier(nodeIdentifier, timeoutMs) {
    // if the address is cached, return that wrapped in a promise
    if (cachedNodes[nodeIdentifier]) {
      return Bluebird.resolve(cachedNodes[nodeIdentifier]);
    }

    debug('Looking up %s', nodeIdentifier);

    return _localCommand('DN', timeoutMs, nodeIdentifier)
      .then(_extractDestination64)
      .then(function (address64) {
        // cache result
        cachedNodes[nodeIdentifier] = address64;
        return address64;
      }).catch(function errorHandler(err) {
        debug('error looking node up by identifier', err);
        // any error from _sendFramePromiseResponse implies node not found
        throw new Error('Node not found');
      });
  }


  // Sends a the given command and parameter to the given destination.
  // A promise is returned that will resolve to the resulting command
  // data on success or result in an Error with the failed status as
  // the text.  Only one of destination64 or destination16 should be
  // given; the other should be undefined.
  function _remoteCommand(command, destination64, destination16, timeoutMs, commandParameter) {
      var frame = {
            type: xbee_api.constants.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
            command: command,
            commandParameter: commandParameter,
            destination64: destination64,
            destination16: destination16
          };

      debug('Sending %s to %s with parameter %s', command, destination64, commandParameter || []);

      return _sendFramePromiseResponse(frame, timeoutMs, xbee_api.constants.FRAME_TYPE.REMOTE_COMMAND_RESPONSE)
        .then(function (frame) {
          if (frame.commandStatus === xbee_api.constants.COMMAND_STATUS.OK) {
            return frame.commandData;
          }

          // if not OK, throw error
          throw new Error(xbee_api.constants.COMMAND_STATUS[frame.commandStatus]);
        });
  }


  // Sends a the given data to the given destination.  A promise is
  // returned that will resolve to 'true' on success or result in an
  // Error with the failed status as the text.  Only one of
  // destination64 or destination16 should be given; the other should
  // be undefined.
  function _remoteTransmit(destination64, destination16, data, timeoutMs) {
    var frame = {
          data: data,
          type: xbee_api.constants.FRAME_TYPE.ZIGBEE_TRANSMIT_REQUEST,
          destination64: destination64,
          destination16: destination16
        },
        responseFrameType = xbee_api.constants.FRAME_TYPE.ZIGBEE_TRANSMIT_STATUS;

    if (module === '802.15.4') {
      responseFrameType = xbee_api.constants.FRAME_TYPE.TX_STATUS;
      frame.type = destination64 ?
        xbee_api.constants.FRAME_TYPE.TX_REQUEST_64 :
        xbee_api.constants.FRAME_TYPE.TX_REQUEST_16;
    }

    debug('Sending \'%s\' to %s', data, destination64 || destination16);

    return _sendFramePromiseResponse(frame, timeoutMs, responseFrameType)
      .then(function (frame) {
        if (frame.deliveryStatus === xbee_api.constants.DELIVERY_STATUS.SUCCESS) {
          return true;
        }

        // if not OK, throw error
        throw new Error(xbee_api.constants.DELIVERY_STATUS[frame.deliveryStatus]);
      });
  }


  // Validate the destination found within the given settings object.
  // The existence of exactly one of destinationId, destination64 and
  // destination16 and their types are assumed to already be verified.
  // This function must ensure that destination64 is the correct
  // length, if it exists, destination16 is the correct length, if it
  // exists, and destinationId was used only if the module type was
  // not '802.15.4'.
  function _validateDestination(settings) {
    var hexRegex = /^[0-9a-f]+$/;

    if (settings.destinationId && module === '802.15.4') {
      throw new Error('\'destinationId\' is not supported by 802.15.4 modules. Use \'destination16\' or \'destination64\' instead.');
    }

    if (typeof settings.destination64 === 'string') {
      if (settings.destination64.length !== 16) {
        throw new Error('\'destination64\' is not the correct length. It must be a hex string of length 16 or a byte array of length 8.');
      }
      if (!settings.destination64.match(hexRegex)) {
        throw new Error('\'destination64\' is not a hex string. It must be a hex string of length 16 or a byte array of length 8.');
      }
    } else if (util.isArray(settings.destination64)) {
      if (settings.destination64.length !== 8) {
        throw new Error('\'destination64\' is not the correct length. It must be a hex string of length 16 or a byte array of length 8.');
      }
      settings.destination64.forEach(function (element) {
        if (typeof element !== 'number' || element < 0 || element > 255) {
          throw new Error('\'destination64\' is not a byte array. It must be a hex string of length 16 or a byte array of length 8.');
        }
      });
    }

    if (typeof settings.destination16 === 'string') {
      if (settings.destination16.length !== 4) {
        throw new Error('\'destination16\' is not the correct length. It must be a hex string of length 4 or a byte array of length 2.');
      }
      if (!settings.destination16.match(hexRegex)) {
        throw new Error('\'destination16\' is not a hex string. It must be a hex string of length 4 or a byte array of length 2.');
      }
    } else if (util.isArray(settings.destination16)) {
      if (settings.destination16.length !== 2) {
        throw new Error('\'destination16\' is not the correct length. It must be a hex string of length 4 or a byte array of length 2.');
      }
      settings.destination16.forEach(function (element) {
        if (typeof element !== 'number' || element < 0 || element > 255) {
          throw new Error('\'destination16\' is not a byte array. It must be a hex string of length 4 or a byte array of length 2.');
        }
      });
    }
  }

  function discoverNodes(callback) {
    if(!callback)
      throw new Error('You must supply a callback to recieve the discovered nodes');

    // Read NT - discovery timeout
    return localCommand('NT')
      
    // Send ND to begin discovery with timeout NT + 1000
    .then(function(nt) {
      // Last element is NT's value
      nt = nt.pop();
      debug('Got NT value: %s', nt);

      // Listen for node info frames
      function nodeInfoListener(frame) {
        // See if this is the frame we're looking for
        if(frame.type === xbee_api.constants.FRAME_TYPE.AT_COMMAND_RESPONSE && frame.command === 'ND' && frame.nodeIdentification) { 
          var node = frame.nodeIdentification;
          
          debug('Got discovered node %s', node.remote64);
          // Let the caller know that we found a node
          callback(node);
        }
      }
      xbeeAPI.on('frame_object', nodeInfoListener);

      // Begin the node discovery
      return localCommand('ND')

      // Fulfill promise when NT expires
      // NT is 1/10 seconds
      .delay(nt * 100)
      
      // Detatch the node info listener
      .finally(function() {
        xbeeAPI.removeListener('frame_object', nodeInfoListener);
      });
    });
  }

  function localCommand(settings) {
    // Support simple string for getting an AT value
    if(typeof settings === 'string')
      settings = { command: settings };

    settings = settings || {};

    var command,
        commandParameter,
        timeoutMs = settings.timeoutMs || defaultTimeoutMs;

    parambulator({
      command: { required$:true, string$:true, notempty$:true, re$:/^[a-z]{2}$/i },
      commandParameter: { type$: [ 'string', 'array' ] },
      timeoutMs: { type$: 'integer', min$: 10 }
    }).validate(settings, function(err) { if(err) throw err; });

    command = settings.command;

    commandParameter = settings.commandParameter || [];

    return _localCommand(command, timeoutMs, commandParameter);
  }


  function remoteCommand(settings) {
    settings = settings || {};

    var command,
        commandParameter,
        timeoutMs = settings.timeoutMs || defaultTimeoutMs;

    parambulator({
      command: { required$:true, string$:true, notempty$:true, re$:/^[a-z]{2}$/i },
      commandParameter: { type$: [ 'string', 'array' ] },
      exactlyone$: [ 'destinationId', 'destination64', 'destination16' ],
      destinationId: { type$: [ 'string' ] },
      destination64: { type$: [ 'string', 'array' ] },
      destination16: { type$: [ 'string', 'array' ] },
      timeoutMs: { type$: 'integer', min$: 10 }
    }).validate(settings, function(err) { if(err) throw err; });

    _validateDestination(settings);

    command = settings.command;

    commandParameter = settings.commandParameter || [];

    if (settings.destination64 || settings.destination16) {
      return _remoteCommand(command, settings.destination64, settings.destination16, timeoutMs, commandParameter);
    }

    if (settings.destinationId) {
      return _lookupByNodeIdentifier(settings.destinationId, timeoutMs)
        .then(function (lookupResult) {
          cachedNodes[settings.destinationId] = lookupResult;
          return _remoteCommand(command, lookupResult, undefined, timeoutMs, commandParameter);
        });
    }
  }


  // TODO test!
  function remoteTransmit(settings) {
    settings = settings || {};

    var data,
        timeoutMs = settings.timeoutMs || defaultTimeoutMs;

    parambulator({
      data: 'required$, string$',
      exactlyone$: [ 'destinationId', 'destination64', 'destination16' ],
      destinationId: { type$: [ 'string' ] },
      destination64: { type$: [ 'string', 'array' ] },
      destination16: { type$: [ 'string', 'array' ] },
      timeoutMs: { type$: 'integer', min$: 10 }
    }).validate(settings, function(err) { if(err) throw err; });

    _validateDestination(settings);

    // TODO is there a miximum length for 'data'?

    data = settings.data;

    if (settings.destination64 || settings.destination16) {
      return _remoteTransmit(settings.destination64, settings.destination16, data, timeoutMs);
    }

    if (settings.destinationId) {
      return _lookupByNodeIdentifier(settings.destinationId, timeoutMs)
        .then(function (lookupResult) {
          cachedNodes[settings.destinationId] = lookupResult;
          return _remoteTransmit(lookupResult, undefined, data, timeoutMs);
        });
    }
  }

  function toHex4String(val) {
    return ('000' + val.toString(16)).substr(-4);
  }

  function explicitTransmit(settings) {
    settings = settings || {};

    var data,
        timeoutMs = settings.timeoutMs || defaultTimeoutMs;

    parambulator({
      sourceEndpoint: { required$:true, type$:'integer', gte$:0, lte$:0xFF },
      destinationEndpoint: { required$:true, type$:'integer', gte$:0, lte$:0xFF },
      clusterId: { required$:true, type$:'integer', gte$:0, lte$:0xFFFF },
      profileId: { required$:true, type$:'integer', gte$:0, lte$:0xFFFF },
      broadcastRadius: { type$:'integer', gte$:0, lte$:0xFF },
      data: { type$:['string', 'array'] },
      exactlyone$: [ 'destinationId', 'destination64', 'destination16' ],
      destinationId: { type$: [ 'string' ] },
      destination64: { type$: [ 'string', 'array' ] },
      destination16: { type$: [ 'string', 'array' ] },
      timeoutMs: { type$: 'integer', min$: 10 }
    }).validate(settings, function(err) { if(err) throw err; });

    if(module === '802.15.4') {
      throw new Error('Can not send explicit transmits with naked 802.15.4 modules');
    }

    function _explicitTx(destination64, destination16, sourceEndpoint, destinationEndpoint, clusterId, profileId, data) {
      var frame = {
            type: xbee_api.constants.FRAME_TYPE.EXPLICIT_ADDRESSING_ZIGBEE_COMMAND_FRAME,
            destination64: destination64,
            destination16: destination16,
            sourceEndpoint: sourceEndpoint,
            destinationEndpoint: destinationEndpoint,
            clusterId: toHex4String(clusterId),
            profileId: toHex4String(profileId),
            data: data,
          },
          responseFrameType = xbee_api.constants.FRAME_TYPE.ZIGBEE_TRANSMIT_STATUS;

      debug('Sending explicit \'%s\' to %s src:%s dest:%s cluster:%s profile:%s',
        data, destination64 || destination16, toHex4String(sourceEndpoint), toHex4String(destinationEndpoint),
        toHex4String(clusterId), toHex4String(profileId));

      return _sendFramePromiseResponse(frame, timeoutMs, responseFrameType)
        .then(function (frame) {
          debug('Explicit send resolved');
          if (frame.deliveryStatus === xbee_api.constants.DELIVERY_STATUS.SUCCESS) {
            return true;
          }

          // if not OK, throw error
          throw new Error(xbee_api.constants.DELIVERY_STATUS[frame.deliveryStatus]);
        });
    }

    if (settings.destination64 || settings.destination16) {
      return _explicitTx(settings.destination64, settings.destination16,settings.sourceEndpoint,
          settings.destinationEndpoint, settings.clusterId, settings.profileId, settings.data);
    }

    if (settings.destinationId) {
      return _lookupByNodeIdentifier(settings.destinationId, timeoutMs)
        .then(function (lookupResult) {
          cachedNodes[settings.destinationId] = lookupResult;
          return _explicitTx(lookupResult, undefined,settings.sourceEndpoint,
              settings.destinationEndpoint, settings.clusterId, settings.profileId, settings.data);
        });
    }
  }


  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // Initialization
  //~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  options = options || {};

  parambulator({
    serialport: 'required$, string$',
    required$: 'module',
    module: { enum$: [ '802.15.4', 'ZNet', 'ZigBee' ] },
    api_mode: { enum$: [ 1, 2 ] },
    serialportOptions: 'object$',
    defaultTimeoutMs: { type$: 'integer', min$: 10 }
  }).validate(options, function (err) { if (err) throw err; });

  module = options.module;

  xbeeAPI = new xbee_api.XBeeAPI({
    api_mode: options.api_mode || 1,
    module: module
  });

  options.serialportOptions = options.serialportOptions || {};

  options.serialportOptions.parser = xbeeAPI.rawParser();

  debug('Connecting to serialport %s', options.serialport);
  serialport = new serial.SerialPort(options.serialport, options.serialportOptions);

  defaultTimeoutMs = options.defaultTimeoutMs || 5000;

  return {
    localCommand: localCommand,
    remoteCommand: remoteCommand,
    remoteTransmit: remoteTransmit,
    explicitTransmit: explicitTransmit,
    discoverNodes: discoverNodes,
    close: closeSerialport
  };
};
