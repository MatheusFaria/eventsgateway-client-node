/* eslint-disable import/no-extraneous-dependencies */
const os = require('os')
const prometheusclient = require('prom-client')
const sap = require('supertest-as-promised')
const sinon = require('sinon')
const uuid = require('uuid/v4')
const { expect } = require('chai')
const {
  afterEach, beforeEach, describe, it,
} = require('mocha')
require('co-mocha')

const configDefault = require('./../../src/config/default.json')
const configTest = require('./../../src/config/test.json')
const Client = require('./../../src/client')

const parsePrometheusResponse = (text) => {
  const messages = text.split(/\r?\n/)
  return messages.map((m) => {
    if (m.startsWith('#') || m.length === 0) {
      return null
    }
    const re = /(.*){(.*)}\s(\d)/
    const matches = re.exec(m)
    const tags = {}
    matches[2].split(',').forEach((t) => {
      tags[t.split('=')[0]] = JSON.parse(t.split('=')[1])
    })
    return { metric: matches[1], tags, val: parseInt(matches[3], 10) }
  }).filter(m => !!m)
}

describe('Client', () => {
  describe('Constructor', () => {
    it('returns client if no error and default config and topic', () => {
      const client = new Client()
      expect(client.config).to.equal(configDefault)
      expect(client.topic).to.equal(configDefault.kafkatopic)
      expect(client.hostname).to.equal(os.hostname())
      expect(client.grpcClient).not.to.equal(undefined)
      expect(client.logger).not.to.equal(undefined)
      expect(client.metrics).not.to.equal(undefined)
      expect(client.metrics.prometheus).not.to.equal(undefined)
      expect(client.metrics.statsd).not.to.equal(undefined)
    })

    it('returns client with provided config and topic', () => {
      const client = new Client(configTest, 'my-topic')
      expect(client.config).to.equal(configTest)
      expect(client.topic).to.equal('my-topic')
      expect(client.hostname).to.equal(os.hostname())
      expect(client.grpcClient).not.to.equal(undefined)
      expect(client.logger).not.to.equal(undefined)
      expect(client.metrics).not.to.equal(undefined)
      expect(client.metrics.prometheus).not.to.equal(undefined)
      expect(client.metrics.statsd).not.to.equal(undefined)
    })

    it('throws exception if no kafka topic', () => {
      const config = JSON.parse(JSON.stringify(configTest))
      delete config.kafkatopic

      const getClient = () => new Client(config)
      expect(getClient).to.throw('no kafka topic informed')
    })

    it('throws exception if no server address', () => {
      const config = JSON.parse(JSON.stringify(configTest))
      delete config.grpc.serveraddress

      const getClient = () => new Client(config)
      expect(getClient).to.throw('no grpc server address informed')
    })
  })

  describe('Send To Topic', () => {
    let client
    let sendEventStub
    let name
    let props
    let topic

    beforeEach(() => {
      client = new Client()
      sendEventStub = sinon.stub(client.grpcClient, 'sendEvent')
      name = 'EventName'
      props = {
        prop1: 'val1',
        prop2: 'val2',
      }
      topic = 'my-topic'
    })

    afterEach(() => {
      client.grpcClient.sendEvent.restore()
    })

    it('sends event to specific topic', function* () {
      sendEventStub.callsArgWith(1, null, {})
      const res = yield client.sendToTopic(name, topic, props)
      expect(Object.keys(res)).to.have.length(0)
      expect(sendEventStub.calledOnce).to.equal(true)
      const sentEvent = sendEventStub.getCall(0).args[0]
      expect(sentEvent.id).to.be.a('string')
      expect(sentEvent.id).to.have.length.gt(0)
      expect(sentEvent.name).to.equal(name)
      expect(sentEvent.topic).to.equal(topic)
      expect(sentEvent.props).to.equal(props)
      expect(sentEvent.timestamp).to.be.a('number')
      expect(sentEvent.timestamp).to.be.approximately(Date.now(), 100)
    })

    it('throws exception if event rpc call failed', function* () {
      const error = new Error('some error occured')
      sendEventStub.callsArgWith(1, error, null)
      try {
        yield client.sendToTopic(name, topic, props)
        throw new Error('should not reach this line of code')
      } catch (e) {
        expect(sendEventStub.calledOnce).to.equal(true)
        expect(e).to.equal(error)
      }
    })
  })

  describe('Send', () => {
    let client
    let sendEventStub
    let name
    let props

    beforeEach(() => {
      client = new Client()
      sendEventStub = sinon.stub(client.grpcClient, 'sendEvent')
      name = 'EventName'
      props = {
        prop1: 'val1',
        prop2: 'val2',
      }
    })

    afterEach(() => {
      client.grpcClient.sendEvent.restore()
    })

    it('sends event to configured topic', function* () {
      sendEventStub.callsArgWith(1, null, {})
      const res = yield client.send(name, props)
      expect(Object.keys(res)).to.have.length(0)
      expect(sendEventStub.calledOnce).to.equal(true)
      const sentEvent = sendEventStub.getCall(0).args[0]
      expect(sentEvent.id).to.be.a('string')
      expect(sentEvent.id).to.have.length.gt(0)
      expect(sentEvent.name).to.equal(name)
      expect(sentEvent.topic).to.equal(configDefault.kafkatopic)
      expect(sentEvent.props).to.equal(props)
      expect(sentEvent.timestamp).to.be.a('number')
      expect(sentEvent.timestamp).to.be.approximately(Date.now(), 100)
    })

    it('throws exception if event rpc call failed', function* () {
      const error = new Error('some error occured')
      sendEventStub.callsArgWith(1, error, null)
      try {
        yield client.send(name, props)
        throw new Error('should not reach this line of code')
      } catch (e) {
        expect(sendEventStub.calledOnce).to.equal(true)
        expect(e).to.equal(error)
      }
    })
  })

  describe('Metrics', () => {
    // TODO: test statsd metrics

    let client
    let sendEventStub
    let name
    let props
    let metricsServer
    let request

    beforeEach(() => {
      client = new Client(undefined, uuid())
      sendEventStub = sinon.stub(client.grpcClient, 'sendEvent')
      name = 'EventName'
      props = {
        prop1: 'val1',
        prop2: 'val2',
      }
      prometheusclient.register.resetMetrics()
      metricsServer = client.metrics.prometheus.listen()
      request = sap.agent(metricsServer)
    })

    afterEach(() => {
      client.grpcClient.sendEvent.restore()
      metricsServer.close()
    })

    it('reports metrics in the /metrics endpoint - success', function* () {
      sendEventStub.callsArgWith(1, null, {})
      const res = yield client.send(name, props)
      expect(Object.keys(res)).to.have.length(0)
      expect(sendEventStub.calledOnce).to.equal(true)

      const metricsRes = yield request.get('/metrics')
      expect(metricsRes.status).to.equal(200)
      expect(metricsRes.headers['content-type']).to.equal(prometheusclient.contentType)
      expect(metricsRes.text).not.to.have.length(0)
      const parsedRes =
        parsePrometheusResponse(metricsRes.text).filter(r => r.tags.topic === client.topic)
      parsedRes.forEach((r) => {
        expect(r.tags.clientHost).to.equal(os.hostname())
        expect(r.tags.route).to.equal('/eventsgateway.GRPCForwarder/SendEvent')
        expect(r.tags.topic).to.equal(client.topic)
      })
      const resTime = parsedRes.filter(r => r.metric === 'eventsgateway_client_response_time_ms')
      expect(resTime).to.have.length(3) // num percentiles
      const resSuccess = parsedRes.filter(r => r.metric ===
                                          'eventsgateway_client_requests_success_counter')
      expect(resSuccess).to.have.length(1) // num requests
      const resFailure = parsedRes.filter(r => r.metric ===
                                          'eventsgateway_client_requests_failure_counter')
      expect(resFailure).to.have.length(0)
    })

    it('reports metrics in the /metrics endpoint - failure', function* () {
      const error = new Error('some error occured')
      sendEventStub.callsArgWith(1, error, null)
      try {
        yield client.send(name, props)
        throw new Error('should not reach this line of code')
      } catch (e) {
        expect(sendEventStub.calledOnce).to.equal(true)
        expect(e).to.equal(error)

        const metricsRes = yield request.get('/metrics')
        expect(metricsRes.status).to.equal(200)
        expect(metricsRes.headers['content-type']).to.equal(prometheusclient.contentType)
        expect(metricsRes.text).not.to.have.length(0)
        const parsedRes =
          parsePrometheusResponse(metricsRes.text).filter(r => r.tags.topic === client.topic)
        const resTime = parsedRes.filter(r => r.metric === 'eventsgateway_client_response_time_ms')
        expect(resTime).to.have.length(3) // num percentiles
        parsedRes.forEach((r) => {
          expect(r.tags.clientHost).to.equal(os.hostname())
          expect(r.tags.route).to.equal('/eventsgateway.GRPCForwarder/SendEvent')
          expect(r.tags.topic).to.equal(client.topic)
        })
        const resFailure = parsedRes.filter(r => r.metric ===
                                            'eventsgateway_client_requests_failure_counter')
        expect(resFailure).to.have.length(1) // num requests
        expect(resFailure[0].tags.reason).to.equal(error.toString())
        const resSuccess = parsedRes.filter(r => r.metric ===
                                            'eventsgateway_client_requests_success_counter')
        expect(resSuccess).to.have.length(0)
      }
    })
  })
})
