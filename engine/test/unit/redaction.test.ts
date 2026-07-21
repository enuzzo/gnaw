import { describe, expect, it } from "vitest";
import { createRedactor, redactObject, redactText } from "../../src/redaction/redact";

describe("redaction", () => {
  it("redacts bearer tokens, auth headers, cookies, passwords, and storage values from text", () => {
    const input = [
      "Authorization: Bearer gnaw_bearer_secret_DO_NOT_LEAK",
      "Cookie: gnaw_auth=gnaw_cookie_secret_DO_NOT_LEAK; theme=dark",
      "Set-Cookie: gnaw_auth=gnaw_set_cookie_secret_DO_NOT_LEAK; Path=/",
      "password=gnaw_password_secret_DO_NOT_LEAK",
      "localStorage gnawLocalAuth=gnaw_local_secret_DO_NOT_LEAK",
      "sessionStorage gnawSessionAuth=gnaw_session_secret_DO_NOT_LEAK",
      "localStorage.setItem(\"runtime\", \"gnaw_runtime_local_secret_DO_NOT_LEAK\")",
      "sessionStorage.setItem('runtime', 'gnaw_runtime_session_secret_DO_NOT_LEAK')",
      "<input type=\"password\" value=\"gnaw_runtime_password_secret_DO_NOT_LEAK\">"
    ].join("\n");

    const output = redactText(input);

    expect(output).not.toContain("gnaw_bearer_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_cookie_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_set_cookie_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_password_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_local_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_session_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_runtime_local_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_runtime_session_secret_DO_NOT_LEAK");
    expect(output).not.toContain("gnaw_runtime_password_secret_DO_NOT_LEAK");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts sensitive URL credentials and query parameters inside nested objects", () => {
    const output = redactObject({
      url: "https://user:gnaw_password_secret_DO_NOT_LEAK@example.com/dashboard?token=gnaw_token_secret_DO_NOT_LEAK&ok=1#access_token=gnaw_hash_secret_DO_NOT_LEAK&id_token=gnaw_id_secret_DO_NOT_LEAK&section=main",
      hashRoute: "https://example.com/#/callback?access_token=gnaw_spa_hash_secret_DO_NOT_LEAK&id_token=gnaw_spa_id_secret_DO_NOT_LEAK&section=main",
      nested: {
        header: "Authorization: Basic gnaw_basic_secret_DO_NOT_LEAK"
      }
    });

    expect(JSON.stringify(output)).not.toContain("gnaw_password_secret_DO_NOT_LEAK");
    expect(JSON.stringify(output)).not.toContain("gnaw_token_secret_DO_NOT_LEAK");
    expect(JSON.stringify(output)).not.toContain("gnaw_hash_secret_DO_NOT_LEAK");
    expect(JSON.stringify(output)).not.toContain("gnaw_id_secret_DO_NOT_LEAK");
    expect(JSON.stringify(output)).not.toContain("gnaw_spa_hash_secret_DO_NOT_LEAK");
    expect(JSON.stringify(output)).not.toContain("gnaw_spa_id_secret_DO_NOT_LEAK");
    expect(JSON.stringify(output)).not.toContain("gnaw_basic_secret_DO_NOT_LEAK");
    expect(output.url).toContain("token=%5BREDACTED%5D");
    expect(output.url).toContain("access_token=%5BREDACTED%5D");
    expect(output.url).toContain("id_token=%5BREDACTED%5D");
    expect(output.url).toContain("section=main");
    expect(output.url).toContain("ok=1");
    expect(output.hashRoute).toContain("access_token=%5BREDACTED%5D");
    expect(output.hashRoute).toContain("id_token=%5BREDACTED%5D");
    expect(output.hashRoute).toContain("section=main");
  });

  it("does not corrupt localStorage comparison expressions in captured source", () => {
    const source =
      "const accepted=()=>{ try{return localStorage.getItem(KEY)==='1';}catch(e){return false;} };";

    expect(redactText(source)).toBe(source);
  });

  it("does not reach across statements to redact an unrelated later assignment", () => {
    const source = "localStorage; document.title = userVisibleValue;";

    expect(redactText(source)).toBe(source);
  });

  it("still redacts a real storage assignment while leaving surrounding code intact", () => {
    const output = redactText("localStorage.token = 'gnaw_storage_secret_DO_NOT_LEAK'; render();");

    expect(output).not.toContain("gnaw_storage_secret_DO_NOT_LEAK");
    expect(output).toContain("localStorage.token = [REDACTED]; render();");
  });

  it("redacts common OAuth/API secret keys in JSON without touching benign keys", () => {
    const output = redactText(
      [
        '{"access_token":"gnaw_at_DO_NOT_LEAK"}',
        '{"refresh_token":"gnaw_rt_DO_NOT_LEAK"}',
        '{"id_token":"gnaw_it_DO_NOT_LEAK"}',
        '{"api_key":"gnaw_ak_DO_NOT_LEAK"}',
        '{"client_secret":"gnaw_cs_DO_NOT_LEAK"}',
        '{"csrfToken":"gnaw_csrf_DO_NOT_LEAK"}',
        '{"author":"Jane Doe","idempotency_key":"keep-1234","title":"Login"}'
      ].join("\n")
    );

    for (const leak of ["gnaw_at", "gnaw_rt", "gnaw_it", "gnaw_ak", "gnaw_cs", "gnaw_csrf"]) {
      expect(output).not.toContain(`${leak}_DO_NOT_LEAK`);
    }
    // Benign keys and their values must survive untouched.
    expect(output).toContain('"author":"Jane Doe"');
    expect(output).toContain('"idempotency_key":"keep-1234"');
    expect(output).toContain('"title":"Login"');
  });

  it("redacts quoted and unquoted password values", () => {
    expect(redactText('password = "SuperSecret123"')).not.toContain("SuperSecret123");
    expect(redactText("password=plainpw_DO_NOT_LEAK")).not.toContain("plainpw_DO_NOT_LEAK");
    expect(redactText("const password = 'p@ss w/ space';")).not.toContain("p@ss");
  });

  it("redacts non-Bearer Authorization headers without corrupting mid-line code", () => {
    expect(redactText("Authorization: token ghp_realGitHubToken1234567890"))
      .not.toContain("ghp_realGitHubToken1234567890");
    expect(redactText("Authorization: myrawapikey_DO_NOT_LEAK"))
      .not.toContain("myrawapikey_DO_NOT_LEAK");
    // A mid-line mention inside code must not be treated as a header (no structure eaten).
    const code = "const h = {Authorization: buildHeader(token)};";
    expect(redactText(code)).toBe(code);
  });

  it("does not let short preference values corrupt structural output", () => {
    const redactor = createRedactor(["1", "15", "dark", "gnaw_real_session_token"]);
    const timestamp = "2026-07-15T11:07:29.021Z";

    expect(redactor.redactText(timestamp)).toBe(timestamp);
    expect(redactor.redactText("session=gnaw_real_session_token"))
      .toBe("session=[REDACTED]");
  });
});
