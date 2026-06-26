import fetch from 'node-fetch';

async function test() {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "TEST_WABA_ID",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "1234567890",
            phone_number_id: "TEST_PHONE_ID"
          },
          contacts: [{
            profile: { name: "Test User" },
            wa_id: "15555555555"
          }],
          messages: [{
            from: "15555555555",
            id: "wamid.HBgLMTU1NTU1NTU1NTUVQAS...",
            timestamp: Math.floor(Date.now() / 1000).toString(),
            text: {
              body: "book"
            },
            type: "text"
          }]
        },
        field: "messages"
      }]
    }]
  };

  const res = await fetch('http://localhost:3000/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  console.log("Status:", res.status);
  console.log("Text:", await res.text());
}
test();
