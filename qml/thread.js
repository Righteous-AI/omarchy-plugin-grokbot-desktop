.pragma library

// Fold a fresh Bot Chat page into the thread already on screen.
// The host gateway (one process for every profile) is the source. A row already
// shown is kept; a row only the Hermes app has is appended. The live exchange
// still sitting in the composer is not copied in a second time.

function exchangeText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim()
}

// Hermes wraps a /steer in this marker and stores it as its own user row.
// The card shows the plain line under the original question.
function askedShown(value) {
  var text = exchangeText(value)
  var open = "[OUT-OF-BAND USER MESSAGE"
  var close = "[/OUT-OF-BAND USER MESSAGE]"
  var at = text.indexOf(open)
  if (at < 0) return text
  var end = text.lastIndexOf(close)
  var innerAt = text.indexOf("]", at)
  if (end < at || innerAt < 0 || innerAt >= end) return text
  var inner = text.slice(innerAt + 1, end).trim()
  var head = text.slice(0, at).trim()
  if (head && inner) return head + "\n\n" + inner
  return inner || text
}

function sameQuestion(a, b) {
  var aAsked = askedShown(a && a.asked)
  var bAsked = askedShown(b && b.asked)
  if (aAsked === "" || bAsked === "") return false
  return aAsked === bAsked
}

// The live slot sits under the history list. Once that question is already
// in the list, leaving the slot up pins the old turn at the bottom.
function liveIsFiled(history, live) {
  if (!live) return false
  var at = -1
  var i
  for (i = 0; i < (history || []).length; i++) {
    var row = history[i]
    if (!row || !row.body) continue
    if (sameTurn(row, live) || sameQuestion(row, live)) at = i
  }
  if (at < 0) return false
  if (at < history.length - 1) return true
  if (sameTurn(history[at], live)) return true
  return exchangeText(live.body) !== exchangeText(history[at].body)
}

function sameBody(a, b) {
  var aBody = exchangeText(a)
  var bBody = exchangeText(b)
  if (aBody === "" || bBody === "") return false
  if (aBody === bBody) return true
  // The card keeps the whole reply while the gateway stores a clipped copy, and
  // a clarification or a note can be appended on one side. One text holding the
  // other whole is the same reply.
  return aBody.indexOf(bBody) === 0 || bBody.indexOf(aBody) === 0
}

function sameExchange(a, b) {
  if (!a || !b) return false
  // Both rows carry a gateway key: the key alone decides. Two turns can share
  // a reply and must stay apart.
  if (a.key && b.key) return String(a.key) === String(b.key)
  // Same reply text is the same turn. A steered follow-up is appended to the
  // local question, so the gateway row may carry only one of the two lines.
  if (!sameBody(a.body, b.body)) return false
  var aAsked = askedShown(a.asked)
  var bAsked = askedShown(b.asked)
  if (aAsked === bAsked || aAsked === "" || bAsked === "") return true
  return aAsked.indexOf(bAsked) !== -1 || bAsked.indexOf(aAsked) !== -1
}

// The live slot carries no gateway key, so body text alone decides whether it
// is already in the list. Identical wording from the reader is common enough
// that the question counts too, as long as one reply holds the other.
function sameTurn(a, b) {
  if (!a || !b) return false
  if (a.key && b.key) return String(a.key) === String(b.key)
  if (sameExchange(a, b)) return true
  return sameQuestion(a, b) && sameBody(a.body, b.body)
}

function preferExchange(kept, row) {
  var next = kept
  if (row.key && !next.key) next = Object.assign({}, next, { key: row.key })
  var rowAsked = askedShown(row.asked)
  var nextAsked = askedShown(next.asked)
  if (rowAsked.length > nextAsked.length)
    next = Object.assign({}, next, { asked: rowAsked })
  else if (String(next.asked || "") !== nextAsked)
    next = Object.assign({}, next, { asked: nextAsked })
  if (row.body && exchangeText(row.body).length > exchangeText(next.body).length)
    next = Object.assign({}, next, { body: row.body })
  if ((row.files || []).length && !(next.files || []).length)
    next = Object.assign({}, next, { files: row.files })
  if ((row.links || []).length && !(next.links || []).length)
    next = Object.assign({}, next, { links: row.links })
  return next
}

function mergeExchanges(existing, incoming, live, limit) {
  var out = []
  var cap = limit > 0 ? limit : (existing || []).length + (incoming || []).length
  var i, j, row, sawLive = null
  // A turn already filed twice (the live copy archived on the next send, plus
  // the gateway copy) collapses back to one before new rows are considered.
  for (i = 0; i < (existing || []).length; i++) {
    row = existing[i]
    var folded = false
    for (j = 0; j < out.length; j++) {
      if (!sameExchange(out[j], row)) continue
      out[j] = preferExchange(out[j], row)
      folded = true
      break
    }
    if (!folded && row) out.push(row)
  }
  for (i = 0; i < (incoming || []).length; i++) {
    row = incoming[i]
    if (!row || !row.body) continue
    var known = false
    for (j = 0; j < out.length; j++) {
      if (!sameExchange(out[j], row)) continue
      known = true
      out[j] = preferExchange(out[j], row)
      break
    }
    if (known) continue
    // The on-screen turn is not copied while it is the latest one. A later
    // turn has to land after it, or the new reply shows above the old question.
    // The live slot has no gateway key, so match it as a turn, not just text.
    if (live && sameTurn(live, row)) {
      sawLive = preferExchange(row, live)
      continue
    }
    if (sawLive) {
      var already = false
      for (j = 0; j < out.length; j++) {
        if (!sameTurn(out[j], sawLive)) continue
        out[j] = preferExchange(out[j], sawLive)
        already = true
        break
      }
      if (!already) out.push(sawLive)
      sawLive = null
    }
    out.push(row)
  }
  return out.slice(Math.max(0, out.length - cap))
}

// True when the latest row is new or its text changed. The first fill of an
// empty thread is not news: that is history the reader has not missed.
function hasNews(before, after) {
  if (!after || after.length === 0 || !before || before.length === 0) return false
  if (after.length > before.length) return true
  var last = after[after.length - 1]
  var prev = before[before.length - 1]
  return String(last.asked || "") !== String(prev.asked || "") || String(last.body || "") !== String(prev.body || "")
}

function sameThread(a, b) {
  if (!a || !b || a.length !== b.length) return false
  var i
  for (i = 0; i < a.length; i++) {
    if (String(a[i].key || "") !== String(b[i].key || "")) return false
    if (String(a[i].asked || "") !== String(b[i].asked || "")) return false
    if (String(a[i].body || "") !== String(b[i].body || "")) return false
  }
  return true
}
