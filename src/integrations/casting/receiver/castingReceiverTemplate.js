export function getCastingReceiverHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Study Cards Receiver</title>
    <link rel="stylesheet" href="./src/integrations/casting/receiver/castingReceiver.css" />
    <script src="//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>
  </head>
  <body>
    <main class="receiver-shell">
      <header class="receiver-header">
        <div id="receiver-title" class="receiver-title">Study Cards</div>
        <div id="receiver-index" class="receiver-index"></div>
      </header>
      <section id="receiver-card" class="receiver-card">
        <div id="receiver-top-left" class="receiver-slot receiver-top-left"></div>
        <div id="receiver-main-wrap" class="receiver-main-wrap">
          <div id="receiver-main" class="receiver-main"></div>
          <div id="receiver-main-secondary" class="receiver-main"></div>
        </div>
        <div id="receiver-bottom-left" class="receiver-slot receiver-bottom-left"></div>
        <div id="receiver-bottom-right" class="receiver-slot receiver-bottom-right"></div>
      </section>
      <div id="receiver-status" class="receiver-status">Waiting for sender...</div>
    </main>
    <script src="./src/integrations/casting/receiver/castingReceiver.js"></script>
  </body>
</html>
`;
}
