/* @flow */

import test  from 'tape-promise/tape'
import * as auth from '../../src/server/authentication'
import * as errors from '../../src/server/errors'
import { HubServer }  from '../../src/server/server'
import { ProofChecker } from '../../src/server/ProofChecker'
import { Readable } from 'stream'
import { DriverModel } from '../../src/server/driverModel'
import type { ListFilesResult } from '../../src/server/driverModel'
import { InMemoryDriver } from './testDrivers/InMemoryDriver'
import { testPairs, testAddrs} from './common'

const TEST_SERVER_NAME = 'test-server'

class MockDriver implements DriverModel {
  lastWrite: any
  constructor() {
    this.lastWrite = null
  }
  getReadURLPrefix() {
    return 'http://test.com/'
  }
  performWrite(write) {
    this.lastWrite = write
    return Promise.resolve(`http://test.com/${write.storageTopLevel}/${write.path}`)
  }
  listFiles(storageTopLevel: string, page: ?string): Promise<ListFilesResult> {
    return Promise.resolve({entries: [], page: page})
  }
}

class MockProofs extends ProofChecker {
  checkProofs() {
    return Promise.resolve()
  }
}

export function testServer() {
  test('validation tests', (t) => {
    t.plan(4)
    const server = new HubServer(new MockDriver(), new MockProofs(),
                                 { serverName: TEST_SERVER_NAME, whitelist: [testAddrs[0]] })
    const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
    const authPart0 = auth.LegacyAuthentication.makeAuthPart(testPairs[1], challengeText)
    const auth0 = `bearer ${authPart0}`

    t.throws(() => server.validate(testAddrs[1], { authorization: auth0 }),
             errors.ValidationError, 'Non-whitelisted address should fail validation')
    t.throws(() => server.validate(testAddrs[0], ({}: any)),
             errors.ValidationError, 'Bad request headers should fail validation')

    const authPart = auth.LegacyAuthentication.makeAuthPart(testPairs[0], challengeText)
    const authorization = `bearer ${authPart}`
    try {
      server.validate(testAddrs[0], { authorization })
      t.pass('White-listed address with good auth header should pass')
    } catch (err) {
      t.fail('White-listed address with good auth header should pass')
    }

    try {
      server.validate(testAddrs[1], { authorization })
      t.fail('Non white-listed address with good auth header should fail')
    } catch (err) {
      t.pass('Non white-listed address with good auth header should fail')
    }
  })

  test('validation with huburl tests', (t) => {
    t.plan(4)
    const server = new HubServer(new MockDriver(), new MockProofs(),
                                 { whitelist: [testAddrs[0]], requireCorrectHubUrl: true,
                                   serverName: TEST_SERVER_NAME, validHubUrls: ['https://testserver.com'] })

    const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

    const authPartGood1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, 'https://testserver.com/')
    const authPartGood2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, 'https://testserver.com')
    const authPartBad1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, undefined)
    const authPartBad2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, 'testserver.com')

    t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad1}` }),
             errors.ValidationError, 'Auth must include a hubUrl')
    t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad2}` }),
             errors.ValidationError, 'Auth must include correct hubUrl')

    try {
      server.validate(testAddrs[0], { authorization: `bearer ${authPartGood1}` })
      t.pass('Address with good auth header should pass')
    } catch (err) {
      t.fail('Address with good auth header should pass')
    }
    try {
      server.validate(testAddrs[0], { authorization: `bearer ${authPartGood2}` })
      t.pass('Address with good auth header should pass')
    } catch (err) {
      t.fail('Address with good auth header should pass')
    }

  })

  test('validation with 2018 challenge texts', (t) => {
    t.plan(5)
    const server = new HubServer(new MockDriver(), new MockProofs(),
                                 { whitelist: [testAddrs[0]], requireCorrectHubUrl: true,
                                   serverName: TEST_SERVER_NAME, validHubUrls: ['https://testserver.com'] })

    const challengeTexts = []
    challengeTexts.push(auth.getChallengeText(TEST_SERVER_NAME))
    auth.getLegacyChallengeTexts(TEST_SERVER_NAME).forEach(challengeText => challengeTexts.push(challengeText))

    const challenge2018 = challengeTexts.find(x => x.indexOf('2018') > 0)
    t.ok(challenge2018, 'Should find a valid 2018 challenge text')

    const authPartGood1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, 'https://testserver.com/')
    const authPartGood2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, 'https://testserver.com')
    const authPartBad1 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, undefined)
    const authPartBad2 = auth.V1Authentication.makeAuthPart(testPairs[0], challengeTexts[1], undefined, 'testserver.com')

    t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad1}` }),
             errors.ValidationError, 'Auth must include a hubUrl')
    t.throws(() => server.validate(testAddrs[0], { authorization: `bearer ${authPartBad2}` }),
             errors.ValidationError, 'Auth must include correct hubUrl')

    try {
      server.validate(testAddrs[0], { authorization: `bearer ${authPartGood1}` })
      t.pass('Address with good auth header should pass')
    } catch (err) {
      t.fail('Address with good auth header should pass')
    }
    try {
      server.validate(testAddrs[0], { authorization: `bearer ${authPartGood2}` })
      t.pass('Address with good auth header should pass')
    } catch (err) {
      t.fail('Address with good auth header should pass')
    }

  })

  test('handle request with readURL', (t) => {
    t.plan(8)
    const mockDriver = new MockDriver()
    const server = new HubServer(mockDriver, new MockProofs(),
                                 { whitelist: [testAddrs[0]], readURL: 'http://potato.com/', serverName: TEST_SERVER_NAME })
    const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
    const authPart = auth.LegacyAuthentication.makeAuthPart(testPairs[0], challengeText)
    const authorization = `bearer ${authPart}`

    const s = new Readable()
    s.push('hello world')
    s.push(null)
    const s2 = new Readable()
    s2.push('hello world')
    s2.push(null)

    server.handleRequest(testAddrs[0], 'foo.txt',
                         { 'content-type' : 'text/text',
                           'content-length': 4,
                          authorization }, s)
      .then(path => {
        t.equal(path, `http://potato.com/${testAddrs[0]}/foo.txt`)
        t.equal(mockDriver.lastWrite.path, 'foo.txt')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'text/text')
      })
      .then(() => server.handleRequest(testAddrs[0], 'foo.txt',
                        { 'content-length': 4,
                           authorization }, s2))
      .then(path => {
        t.equal(path, `http://potato.com/${testAddrs[0]}/foo.txt`)
        t.equal(mockDriver.lastWrite.path, 'foo.txt')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
      })
  })

  test('handle request', (t) => {
    t.plan(8)
    const mockDriver = new MockDriver()
    const server = new HubServer(mockDriver, new MockProofs(),
                                 { whitelist: [testAddrs[0]], serverName: TEST_SERVER_NAME })
    const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
    const authPart = auth.LegacyAuthentication.makeAuthPart(testPairs[0], challengeText)
    const authorization = `bearer ${authPart}`

    const s = new Readable()
    s.push('hello world')
    s.push(null)
    const s2 = new Readable()
    s2.push('hello world')
    s2.push(null)

    server.handleRequest(testAddrs[0], 'foo.txt',
                         { 'content-type' : 'text/text',
                           'content-length': 4,
                           authorization }, s)
      .then(path => {
        t.equal(path, `http://test.com/${testAddrs[0]}/foo.txt`)
        t.equal(mockDriver.lastWrite.path, 'foo.txt')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'text/text')
      })
      .then(() => server.handleRequest(testAddrs[0], 'foo.txt',
                         { 'content-length': 4,
                           authorization }, s2))
      .then(path => {
        t.equal(path, `http://test.com/${testAddrs[0]}/foo.txt`)
        t.equal(mockDriver.lastWrite.path, 'foo.txt')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
      })
  })

  test('fail writes with revoked auth token', async (t) => {

    const mockDriver = new InMemoryDriver()
    const server = new HubServer(mockDriver, new MockProofs(), {serverName: TEST_SERVER_NAME})
    const challengeText = auth.getChallengeText(TEST_SERVER_NAME)
    let authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText)
    let authorization = `bearer ${authPart}`

    const getJunkData = () => {
      const s = new Readable()
      s.push('hello world')
      s.push(null)
      return s
    }

    // no revocation timestamp has been set, write request should succeed
    await server.handleRequest(testAddrs[0], '/foo/bar', 
                              { 'content-type' : 'text/text',
                                'content-length': 400,
                                authorization }, getJunkData())

    // revoke the auth token (setting oldest valid date into the future)
    const futureDate = (Date.now()/1000|0) + 10000
    await server.handleAuthBump(testAddrs[0], futureDate, { authorization })

    // write should fail with auth token creation date older than the revocation date 
    await t.rejects(server.handleRequest(testAddrs[0], '/foo/bar',
                         { 'content-type' : 'text/text',
                           'content-length': 400,
                           authorization }, getJunkData()), errors.AuthTokenTimestampValidationError, 'write with revoked auth token should fail')

    // create a auth token with creationDate forced further into the future
    authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, undefined, undefined, futureDate + 10000)
    authorization = `bearer ${authPart}`
  
    // request should succeed with a token creationDate newer than the revocation date
    await server.handleRequest(testAddrs[0], '/foo/bar', 
                              { 'content-type' : 'text/text',
                                'content-length': 400,
                                authorization }, getJunkData())
  })
  
  test('handle scoped writes', (t) => {

    const writeScopes = [
      {
        scope: 'putFile',
        domain: '/foo/bar',
      },
      {
        scope: 'putFilePrefix',
        domain: 'baz'
      }
    ]

    const mockDriver = new MockDriver()
    const server = new HubServer(mockDriver, new MockProofs(),
                                 { whitelist: [testAddrs[0]], serverName: TEST_SERVER_NAME })
    const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

    const authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, undefined, undefined, writeScopes)

    console.log(`V1 storage validation: ${authPart}`)

    const authorization = `bearer ${authPart}`
    const authenticator = auth.parseAuthHeader(authorization)
    t.throws(() => authenticator.isAuthenticationValid(testAddrs[1], [challengeText]),
             errors.ValidationError, 'Wrong address must throw')
    t.throws(() => authenticator.isAuthenticationValid(testAddrs[0], ['potatos are tasty']),
             errors.ValidationError, 'Wrong challenge text must throw')
    t.ok(authenticator.isAuthenticationValid(testAddrs[0], [challengeText]),
         'Good signature must pass')

    // scopes must be present
    const authScopes = authenticator.getAuthenticationScopes()
    t.equal(authScopes[0].scope, 'putFile', 'scope 0 is putfile')
    t.equal(authScopes[0].domain, '/foo/bar', 'scope 0 is for /foo/bar')
    t.equal(authScopes[1].scope, 'putFilePrefix', 'scope 1 is putFilePrefix')
    t.equal(authScopes[1].domain, 'baz', 'scope 1 is for baz')

    // write to /foo/bar or /baz will succeed
    const s = new Readable()
    s.push('hello world')
    s.push(null)
    const s2 = new Readable()
    s2.push('hello world')
    s2.push(null)
    const s3 = new Readable()
    s3.push('hello world')
    s3.push(null)
    const s4 = new Readable()
    s4.push('hello world')
    s4.push(null)

    server.handleRequest(testAddrs[0], '/foo/bar',
                         { 'content-type' : 'text/text',
                           'content-length': 4,
                           authorization }, s)
      .then(path => {
        // NOTE: the double-/ is *expected*
        t.equal(path, `http://test.com/${testAddrs[0]}//foo/bar`)
        t.equal(mockDriver.lastWrite.path, '/foo/bar')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'text/text')
      })
      .then(() => server.handleRequest(testAddrs[0], 'baz/foo.txt',
                         { 'content-length': 4,
                           authorization }, s2))
      .then(path => {
        t.equal(path, `http://test.com/${testAddrs[0]}/baz/foo.txt`)
        t.equal(mockDriver.lastWrite.path, 'baz/foo.txt')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
      })
      .then(() => server.handleRequest(testAddrs[0], '/nope/foo.txt',
                         { 'content-length': 4,
                           authorization }, s3))
      .catch((e) => {
        t.throws(() => { throw e }, errors.ValidationError, 'invalid path prefix should fail')
      })
      .then(() => server.handleRequest(testAddrs[0], '/foo/bar/nope.txt',
                                      { 'content-length': 4,
                                      authorization }, s4))
      .catch((e) => {
        t.throws(() => { throw e }, errors.ValidationError, 'putFile does not allow prefixes')
        t.end()
      })
  })

  test('handle scoped writes with association tokens', (t) => {

    const writeScopes = [
      {
        scope: 'putFile',
        domain: '/foo/bar',
      },
      {
        scope: 'putFilePrefix',
        domain: 'baz'
      }
    ]

    const mockDriver = new MockDriver()
    const server = new HubServer(mockDriver, new MockProofs(),
                                 { whitelist: [testAddrs[1]], serverName: TEST_SERVER_NAME })
    const challengeText = auth.getChallengeText(TEST_SERVER_NAME)

    const associationToken = auth.V1Authentication.makeAssociationToken(testPairs[1], testPairs[0].publicKey.toString('hex'))
    const authPart = auth.V1Authentication.makeAuthPart(testPairs[0], challengeText, associationToken, undefined, writeScopes)

    console.log(`V1 storage validation: ${authPart}`)

    const authorization = `bearer ${authPart}`
    const authenticator = auth.parseAuthHeader(authorization)
    t.throws(() => authenticator.isAuthenticationValid(testAddrs[1], [challengeText]),
             errors.ValidationError, 'Wrong address must throw')
    t.throws(() => authenticator.isAuthenticationValid(testAddrs[0], ['potatos are tasty']),
             errors.ValidationError, 'Wrong challenge text must throw')
    t.ok(authenticator.isAuthenticationValid(testAddrs[0], [challengeText]),
         'Good signature must pass')

    // write to /foo/bar or baz will succeed
    const s = new Readable()
    s.push('hello world')
    s.push(null)
    const s2 = new Readable()
    s2.push('hello world')
    s2.push(null)
    const s3 = new Readable()
    s3.push('hello world')
    s3.push(null)
    const s4 = new Readable()
    s4.push('hello world')
    s4.push(null)

    server.handleRequest(testAddrs[0], '/foo/bar',
                         { 'content-type' : 'text/text',
                           'content-length': 4,
                           authorization }, s)
      .then(path => {
        // NOTE: the double-/ is *expected*
        t.equal(path, `http://test.com/${testAddrs[0]}//foo/bar`)
        t.equal(mockDriver.lastWrite.path, '/foo/bar')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'text/text')
      })
      .then(() => server.handleRequest(testAddrs[0], 'baz/foo.txt',
                         { 'content-length': 4,
                           authorization }, s2))
      .then(path => {
        t.equal(path, `http://test.com/${testAddrs[0]}/baz/foo.txt`)
        t.equal(mockDriver.lastWrite.path, 'baz/foo.txt')
        t.equal(mockDriver.lastWrite.storageTopLevel, testAddrs[0])
        t.equal(mockDriver.lastWrite.contentType, 'application/octet-stream')
      })
      .then(() => server.handleRequest(testAddrs[0], '/nope/foo.txt',
                         { 'content-length': 4,
                           authorization }, s3))
      .catch((e) => {
        t.throws(() => { throw e }, errors.ValidationError, 'invalid prefix should fail')
      })
      .then(() => server.handleRequest(testAddrs[0], '/foo/bar/nope.txt',
                        { 'content-length': 4,
                          authorization }, s4 ))
      .catch((e) => {
        t.throws(() => { throw e }, errors.ValidationError, 'putFile does not permit prefixes')
        t.end()
      })
  })
}
