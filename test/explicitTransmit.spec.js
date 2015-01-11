/*
 * Copyright 2014 ProdataKey, LLC.
 * Licensed under the MIT license
 */

'use strict';

var xbeeApi = require('xbee-api'),
    consts = xbeeApi.constants,
    xbeePromise = require('../lib/xbee-promise'),
    _ = require('lodash'),
    serial = require('serialport');

function toHex4String(val) {
  return ('000' + val.toString(16)).substr(-4);
}

describe('Explicit Transmit', function() {
  var serialConstructorStub;
  before(function() {
    // Create a stub instance and then
    // stub the constructor to return that instance
    var serialStub = sinon.createStubInstance(serial.SerialPort);
    serialConstructorStub = sinon.stub(serial, 'SerialPort');
    serialConstructorStub.returns(serialStub);
  });
  after(function() {
    serialConstructorStub.restore();
  });

  var xbee,
      constructorStub,
      xbeeStub;

  beforeEach(function () {
    xbeeStub = sinon.createStubInstance(xbeeApi.XBeeAPI);
    xbeeStub.nextFrameId.returns(42);

    constructorStub = sinon.stub(xbeeApi, 'XBeeAPI');
    constructorStub.returns(xbeeStub);
    
    xbee = xbeePromise({ serialport: 'serialport path', module: 'ZigBee' });
  });
  afterEach(function() {
    constructorStub.restore();
  });

  it('should have explicit transmit function', function() {
    xbee.should.respondTo('explicitTransmit');
  });

  describe('address resolution', function() {
    var settings;
    var frame;
    beforeEach(function() {
      settings = {
        sourceEndpoint: 0x00,
        destinationEndpoint: 0x00,
        clusterId: 0x0000,
        profileId: 0x0000
      };

      frame = {
        id: 42,
        type: consts.FRAME_TYPE.EXPLICIT_ADDRESSING_ZIGBEE_COMMAND_FRAME,
        sourceEndpoint: settings.sourceEndpoint,
        destinationEndpoint: settings.destinationEndpoint,
        clusterId: toHex4String(settings.clusterId),
        profileId: toHex4String(settings.profileId),
        data: undefined
      };
    });

    it('should use unknown 16-bit with 64-bit address', function() {
      settings = _.merge({
        destination64: '0123456789ABCDEF'
      }, settings);

      xbee.explicitTransmit(settings);

      frame = _.merge({
        destination64: settings.destination64,
        destination16: undefined
      }, frame); 

      xbeeStub.buildFrame.should.have.been.calledWith(frame);
    });

    it('should use unknown 64-bit with 16-bit address', function() {
      settings = _.merge({
        destination16: 'AABB'
      }, settings);

      xbee.explicitTransmit(settings);

      frame = _.merge({
        destination64: undefined,
        destination16: settings.destination16
      }, frame); 

      xbeeStub.buildFrame.should.have.been.calledWith(frame);
    });

    it('should look up ID with destinationId', function() {
      settings = _.merge({
        destinationId: 'OtherGuy'
      }, settings);
      
      // Resolve the lookup request
      xbeeStub.on.withArgs('frame_object').onFirstCall().yields({
        id: 42,
        commandData: new Buffer('00000123456789ABCDEF', 'hex'),
        type: consts.FRAME_TYPE.AT_COMMAND_RESPONSE,
        commandStatus: consts.COMMAND_STATUS.OK
      })
      // Resolve the explicit send
      .onSecondCall().yields({
        id: frame.id,
        type: consts.FRAME_TYPE.ZIGBEE_TRANSMIT_STATUS,
        deliveryStatus: consts.DELIVERY_STATUS.SUCCESS
      });
      console.log(xbeeStub.on.callCount);

      var promise =  xbee.explicitTransmit(settings).then(function() {
        xbeeStub.buildFrame.should.have.been.calledTwice();
        xbeeStub.buildFrame.should.have.been.calledWith(frame);
      });

      frame = _.merge({
        destination64: '0123456789abcdef',
        destination16: undefined
      }, frame); 

      return promise;
    });
  });

  describe('preconditions', function() {
    var settings;
    beforeEach(function() {
      settings = {
        destination64: '0123456789ABCDEF',
        sourceEndpoint: 0x00,
        destinationEndpoint: 0x00,
        clusterId: 0x0000,
        profileId: 0x0000
      };
    });

    describe('sourceEndpoint', function() {
      it('should be required', function() {
        delete settings.sourceEndpoint;

        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/sourceEndpoint' is missing/i);
      });

      it('should be an integer', function() {
        settings.sourceEndpoint = 'foo';
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/is not of type 'integer'.*sourceEndpoint/i);
      });

      it('should be gte 0', function() {
        settings.sourceEndpoint = -1;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not greater than or equal.*sourceEndpoint/i);
      });

      it('should be lte 0xFF', function() {
        settings.sourceEndpoint = 0xFFF;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not less than or equal.*sourceEndpoint/i);
      });
    });

    describe('destinationEndpoint', function() {
      it('should be required', function() {
        delete settings.destinationEndpoint;

        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/destinationEndpoint' is missing/i);
      });

      it('should be an integer', function() {
        settings.destinationEndpoint = 'foo';
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/is not of type 'integer'.*destinationEndpoint/i);
      });

      it('should be gte 0', function() {
        settings.destinationEndpoint = -1;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not greater than or equal.*destinationEndpoint/i);
      });

      it('should be lte 0xFF', function() {
        settings.destinationEndpoint = 0xFFF;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not less than or equal.*destinationEndpoint/i);
      });
    });

    describe('clusterId', function() {
      it('should be required', function() {
        delete settings.clusterId;

        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/clusterId' is missing/i);
      });

      it('should be an integer', function() {
        settings.clusterId = 'foo';
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/is not of type 'integer'.*clusterId/i);
      });

      it('should be gte 0', function() {
        settings.clusterId = -1;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not greater than or equal.*clusterId/i);
      });

      it('should be lte 0xFFFF', function() {
        settings.clusterId = 0xFFFFFF;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not less than or equal.*clusterId/i);
      });
    });

    describe('profileId', function() {
      it('should be required', function() {
        delete settings.profileId;

        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/profileId' is missing/i);
      });

      it('should be an integer', function() {
        settings.profileId = 'foo';
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/is not of type 'integer'.*profileId/i);
      });

      it('should be gte 0', function() {
        settings.profileId = -1;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not greater than or equal.*profileId/i);
      });

      it('should be lte 0xFFFF', function() {
        settings.profileId = 0xFFFFFF;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not less than or equal.*profileId/i);
      });
    });

    describe('broadcastRadius', function() {
      it('should be an integer', function() {
        settings.broadcastRadius = 'foo';
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/is not of type 'integer'.*broadcastRadius/i);
      });

      it('should be gte 0', function() {
        settings.broadcastRadius = -1;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not greater than or equal.*broadcastRadius/i);
      });

      it('should be lte 0xFF', function() {
        settings.broadcastRadius = 0xFFF;
        
        expect(function() {
          xbee.explicitTransmit(settings);
        }).to.throw(/not less than or equal.*broadcastRadius/i);
      });
    });

  });
  
});
