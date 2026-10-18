import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as driver from './streaming/driver.mjs'

const source = '**a *b'
const expected = {
  root: { type: 'root', range: { start: 0, end: 6 }, children: [
    { type: 'paragraph', range: { start: 0, end: 6 }, children: [
      { type: 'strong', range: { start: 0, end: 6 }, children: [
        { type: 'text', range: { start: 2, end: 4 }, value: 'a ' },
        { type: 'emphasis', range: { start: 4, end: 6 }, children: [
          { type: 'text', range: { start: 5, end: 6 }, value: 'b' },
        ] },
      ] },
    ] },
  ] },
  provisional: [
    { path: ['children', 0, 'children', 0], reason: 'unclosed-delimiter' },
    { path: ['children', 0, 'children', 0, 'children', 1], reason: 'unclosed-delimiter' },
  ],
  suppressed: [],
  references: [],
}

function observation() {
  return { ...structuredClone(expected), source, input: 'open', revision: 1 }
}

test('presentation comparator accepts an independently authored nested observation', () => {
  driver.compareObservation(observation(), expected, { source, input: 'open' })
})

test('presentation comparator rejects sibling formatting with the same flattened text', () => {
  const actual = observation()
  const paragraph = actual.root.children[0]
  const emphasis = paragraph.children[0].children.pop()
  paragraph.children.push(emphasis)
  assert.throws(() => driver.compareObservation(actual, expected, { source, input: 'open' }), assert.AssertionError)
})

test('presentation comparator rejects a missing received character', () => {
  const actual = observation()
  actual.root.children[0].children[0].children[0].value = 'a'
  assert.throws(() => driver.compareObservation(actual, expected, { source, input: 'open' }), assert.AssertionError)
})

test('presentation comparator rejects an out-of-source range', () => {
  const actual = observation()
  actual.root.children[0].children[0].children[0].range.end = 7
  assert.throws(() => driver.compareObservation(actual, expected, { source, input: 'open' }), assert.AssertionError)
})

test('presentation comparator rejects a wrong range that is still inside the source', () => {
  const actual = observation()
  actual.root.children[0].children[0].children[0].range.end = 3
  assert.throws(() => driver.compareObservation(actual, expected, { source, input: 'open' }), assert.AssertionError)
})

test('presentation comparator rejects a stale resolved destination', () => {
  const source = '[x](/a)'
  const expected = {
    root: { type: 'root', range: { start: 0, end: 7 }, children: [
      { type: 'paragraph', range: { start: 0, end: 7 }, children: [
        { type: 'link', origin: 'markdown', range: { start: 0, end: 7 }, url: '/a', title: null, children: [
          { type: 'text', range: { start: 1, end: 2 }, value: 'x' },
        ] },
      ] },
    ] }, provisional: [], suppressed: [], references: [],
  }
  const actual = { ...structuredClone(expected), source, input: 'ended', revision: 1 }
  actual.root.children[0].children[0].url = '/stale'
  assert.throws(() => driver.compareObservation(actual, expected, { source, input: 'ended' }), assert.AssertionError)
})

test('presentation comparator rejects normalized text substituted for received source', () => {
  const expected = { root: { type: 'root', range: { start: 0, end: 3 }, children: [
    { type: 'paragraph', range: { start: 0, end: 3 }, children: [
      { type: 'text', range: { start: 0, end: 3 }, value: 'a\uFFFDb' },
    ] },
  ] }, provisional: [], suppressed: [], references: [] }
  const actual = { ...structuredClone(expected), source: 'a\uFFFDb', input: 'ended', revision: 1 }
  assert.throws(() => driver.compareObservation(actual, expected, { source: 'a\0b', input: 'ended' }), assert.AssertionError)
})
