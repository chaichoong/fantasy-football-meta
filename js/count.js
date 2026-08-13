// ══════════════════════════════════════════════════════════════════════
// Visit counter.
//
// Counts two things and nothing else: someone arrived, and someone did
// something once they were here.
//
// It sets NO cookie and stores NOTHING on the visitor's device, so it needs
// no consent banner and there is no personal data to look after. That is a
// deliberate trade: it means we cannot tell a returning visitor from a new
// one. At this scale that answer comes from asking the people we gave it to,
// which is better information anyway.
//
// It must never break the page. Every call is wrapped and failure is ignored.
// ══════════════════════════════════════════════════════════════════════
(function () {
  var ENDPOINT = "https://fpl-relay.kevinbrittain.workers.dev/hit?s=ffm&e=";

  function count(event) {
    try {
      fetch(ENDPOINT + event, { mode: "no-cors", keepalive: true }).catch(function () {});
    } catch (e) {
      /* counting is never worth an error in front of a user */
    }
  }

  count("visit");

  // "action" fires once per page load, on the first real interaction. It is the
  // difference between someone who landed and left, and someone who used it.
  var fired = false;
  document.addEventListener(
    "click",
    function () {
      if (fired) return;
      fired = true;
      count("action");
    },
    { passive: true }
  );
})();
