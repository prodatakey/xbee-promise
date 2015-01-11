/*
 * Copyright 2014 ProdataKey, LLC.
 * Licensed under the MIT license
 */

'use strict';

var xbeePromise = require('../lib/xbee-promise.js'),
    serial = require('serialport');


describe('Serial Port Handling', function () {
  var xbee,
      options,
      serialStub,
      constructorStub;

  beforeEach(function () {
    // Create a stub instance and then
    // stub the constructor to return that instance
    serialStub = sinon.createStubInstance(serial.SerialPort);
    serialStub.drain.yields(); // Drain calls back its first argument

    constructorStub = sinon.stub(serial, 'SerialPort');
    constructorStub.returns(serialStub);

    options = {
      serialport: 'serialport path',
      module: 'ZigBee',
      serialPortOptions: {}
    };

    xbee = xbeePromise(options);
  });

  afterEach(function() {
    constructorStub.restore();
  });

  describe('when opening', function() {

    it('should set serialport parser', function() {
      options.serialportOptions.parser.should.be.a('function');
    });

    it('should new up a serialport instance', function() {
      constructorStub.should.have.been.calledWithNew();
    });

    it('should use serialport options', function() {
      constructorStub.should.have.been.calledWith(options.serialport, options.serialportOptions);
    });

  });

  describe('when sending data before open', function() {

    beforeEach(function() {
      serialStub.paused = true;
      xbee.localCommand({ command: 'ND' });
    });

    it('should wait on open event', function() {
      serialStub.once.should.have.been.called();
      serialStub.once.should.have.been.calledWith('open', sinon.match.func);
    });

    it('should write data once open', function() {
      // Get the callback passed to the `open` event handler
      var eventSub = serialStub.once.getCall(0);
      var callback = eventSub.args[1];

      callback();

      serialStub.write.should.have.been.calledOnce();
    });

  });

  describe('when sending data after open', function() {

    beforeEach(function() {
      xbee.localCommand({ command: 'ND' });
    });

    it('should immediately write data', function() {
      serialStub.write.should.have.been.calledOnce();
    });

  });

  describe('when closed', function () {

    it('should drain and then close the serialport', function () {
      xbee.close();

      serialStub.drain.should.have.been.called();
      serialStub.close.should.have.been.called();
      serialStub.close.should.have.been.calledAfter(serialStub.drain);
    });

  });

});
