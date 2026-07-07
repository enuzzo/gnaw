import { describe, expect, it } from "vitest";
import { redactObject, redactText } from "../../src/redaction/redact";

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
});
