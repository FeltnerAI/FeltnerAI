import { expect, test, type Page } from "@playwright/test";

const branding = {
  server_name: "Test FeltnerAI",
  accent_color: "#6d5dfc",
  logo_url: null,
  favicon_url: null,
  custom_css_url: null,
};

async function handshake(page: Page, setupComplete = true) {
  await page.route("**/api/v1/server", (route) =>
    route.fulfill({
      json: {
        server_uuid: "018f0000-0000-7000-8000-000000000001",
        api_major: 1,
        version: "0.1.0",
        setup_complete: setupComplete,
        public_url: null,
        capabilities: {
          chat_streaming: true,
          portal_sessions: true,
          custom_branding: true,
        },
        branding,
      },
    }),
  );
}

test("completes first-run setup", async ({ page }) => {
  await handshake(page, false);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 401,
      json: { code: "unauthorized", message: "Setup is not complete." },
    }),
  );
  let setupBody: any;
  await page.route("**/api/v1/setup/complete", async (route) => {
    setupBody = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await page.getByLabel("Setup token").fill("temporary-console-token");
  await page.getByLabel(/^Password/).fill("correct horse battery staple");
  await page.getByRole("button", { name: "Complete setup" }).click();
  await expect.poll(() => setupBody?.username).toBe("admin");
  expect(setupBody).not.toHaveProperty("default_theme");
});

test("forces a replacement password before app access", async ({ page }) => {
  await handshake(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 401,
      json: { code: "unauthorized", message: "Sign in" },
    }),
  );
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          username: "alex",
          email: null,
          role: "user",
          disabled: false,
          must_change_password: true,
          theme: "system",
          created_at: new Date().toISOString(),
        },
        csrf_token: "csrf",
        bearer_token: null,
        expires_at: new Date(Date.now() + 10000).toISOString(),
      },
    }),
  );
  await page.route("**/api/v1/auth/password", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto("/login");
  await page.getByLabel("Username or email").fill("alex");
  await page.getByLabel("Password").fill("temporary password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
});

test("admin can open user management and create an account", async ({
  page,
}) => {
  await handshake(page);
  const admin = {
    id: "a1",
    username: "admin",
    email: null,
    role: "admin",
    disabled: false,
    must_change_password: false,
    theme: "system",
    created_at: new Date().toISOString(),
  };
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: admin }),
  );
  await page.route("**/api/v1/admin/users", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 201,
        json: {
          ...admin,
          id: "u2",
          username: "newuser",
          role: "user",
          must_change_password: true,
        },
      });
    return route.fulfill({ json: [admin] });
  });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Create user" }).click();
  await page.getByLabel("Username").fill("newuser");
  await page.getByLabel("Temporary password").fill("temporary password 123");
  await page.getByRole("button", { name: "Create user" }).last().click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
});

test("streams a chat response and exposes regeneration", async ({ page }) => {
  await handshake(page);
  const user = {
    id: "u1",
    username: "user",
    email: null,
    role: "user",
    disabled: false,
    must_change_password: false,
    theme: "system",
    created_at: new Date().toISOString(),
  };
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: user }),
  );
  await page.route("**/api/v1/models", (route) =>
    route.fulfill({
      json: [
        {
          id: "m1",
          provider_id: "p1",
          provider_name: "Local",
          upstream_id: "model",
          display_name: "Model",
          enabled: true,
          is_default: true,
        },
      ],
    }),
  );
  await page.route("**/api/v1/chats", (route) =>
    route.fulfill({
      json: [
        {
          id: "c1",
          title: "Private chat",
          model_id: "m1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    }),
  );
  let generated = false;
  await page.route("**/api/v1/chats/c1/messages", (route) =>
    route.fulfill({
      json: generated
        ? [
            {
              id: "u-message",
              chat_id: "c1",
              role: "user",
              content: "Hello",
              status: "complete",
              model_id: "m1",
              provider_name: null,
              model_name: null,
              created_at: new Date().toISOString(),
            },
            {
              id: "a1",
              chat_id: "c1",
              role: "assistant",
              content: "Hello from the model",
              status: "complete",
              model_id: "m1",
              provider_name: "Local",
              model_name: "Model",
              created_at: new Date().toISOString(),
            },
          ]
        : [],
    }),
  );
  await page.route("**/api/v1/chats/c1/generate", async (route) => {
    generated = true;
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'event: started\ndata: {"event":"started","message_id":"a1"}\n\nevent: delta\ndata: {"event":"delta","content":"Hello from the model"}\n\nevent: completed\ndata: {"event":"completed","message_id":"a1"}\n\n',
    });
  });
  await page.goto("/chats/c1");
  await expect(page.getByRole("combobox", { name: "Model" })).toBeVisible();
  await page.getByLabel("Message").fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hello from the model")).toBeVisible();
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
});
