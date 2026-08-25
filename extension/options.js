// Velo Chrome Extension - Options Page Controller

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("settings-form");
  const serverInput = document.getElementById("velo-server-url");
  const presetSelect = document.getElementById("default-preset");
  const langSelect = document.getElementById("default-lang");
  const statusAlert = document.getElementById("status-alert");

  // Load existing settings
  const { settings } = await chrome.storage.sync.get("settings");
  if (settings) {
    if (settings.veloServerUrl) serverInput.value = settings.veloServerUrl;
    if (settings.defaultPreset) presetSelect.value = settings.defaultPreset;
    if (settings.defaultLang) langSelect.value = settings.defaultLang;
  } else {
    serverInput.value = "http://127.0.0.1:8080";
  }

  // Save on submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const updated = {
      veloServerUrl: serverInput.value.trim().replace(/\/$/, ""),
      defaultPreset: presetSelect.value,
      defaultLang: langSelect.value,
    };

    await chrome.storage.sync.set({ settings: updated });
    statusAlert.style.display = "block";
    setTimeout(() => {
      statusAlert.style.display = "none";
    }, 2500);
  });
});
