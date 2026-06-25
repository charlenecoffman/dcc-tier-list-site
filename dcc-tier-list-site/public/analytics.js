(() => {
  const measurementId = window.dccSiteConfig?.gaMeasurementId ?? "";

  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) {
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);

  window.dataLayer = window.dataLayer || [];

  function gtag() {
    window.dataLayer.push(arguments);
  }

  gtag("js", new Date());
  gtag("config", measurementId);
})();
