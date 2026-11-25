(function () {
  const base = "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/";
  const map = document.createElement("script");
  map.type = "importmap";
  map.textContent = JSON.stringify({
    integrity: {
      [base + "element.min.js"]: "sha384-6N+HI8HAMAoIP/QFZna5dQ5InvK/mipiijjWEWJIiJOX/simqIO4fLvZSQMbUp9f",
      [base + "storage.min.js"]: "sha384-I68UpwZkgCfB4R68KBk7oSjwdRZqI+8zHf73gCvG+J2YFk5fxD3kBQjgt45dGk0Z",
      [base + "url.min.js"]: "sha384-Tz18y5bXbJlZvcrRVBEy+siv1Zp2KKg8jeXdD0AQSeMuPzT5gB+RjQaGeDpWheh3",
      [base + "toast.min.js"]: "sha384-F6CVYciiH723TqgIYwzLHsrZWnFHw3sVXzcsyeP9XEzVHFL/CHvZDfYeFpdQ6is1",
      [base + "qr.min.js"]: "sha384-T9Cn9R2w96x0EV38iuS+fcQTDSUAWP1iwv6AIl8uH0ARd4yedILjDcICfZhDIf+Y"
    }
  });
  document.currentScript.after(map);
})();
