(function () {
  var localAuth = window.localStorage.getItem("gnawLocalAuth");
  var bearerToken = window.localStorage.getItem("gnawBearerToken");
  var sessionSeed = window.localStorage.getItem("gnawSessionSeed");
  var hasCookie = document.cookie.indexOf("gnaw_auth=") !== -1;
  var authenticated = Boolean(localAuth && bearerToken && sessionSeed && hasCookie);

  if (sessionSeed) {
    window.sessionStorage.setItem("gnawSessionAuth", sessionSeed);
  }
  window.localStorage.setItem("gnawRuntimeLocalAuth", "gnaw_runtime_local_secret_DO_NOT_LEAK");
  window.sessionStorage.setItem("gnawRuntimeSessionAuth", "gnaw_runtime_session_secret_DO_NOT_LEAK");

  document.documentElement.dataset.authFixture = authenticated ? "profile-loaded" : "anonymous";

  var state = document.getElementById("auth-state");
  if (state) {
    state.textContent = authenticated ? "Profile state loaded" : "Anonymous state";
  }

  if (bearerToken) {
    fetch("/api/session", {
      headers: {
        Authorization: "Bearer " + bearerToken
      }
    }).catch(function () {
      return undefined;
    });
  }
})();
