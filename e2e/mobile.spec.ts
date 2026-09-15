import { test, expect } from "@playwright/test";

test("profile character fits inside its frame", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/perfil");
  const frame = page.locator(".profile-card-mascot");
  await expect(frame).toBeVisible();
  const geometry = await frame.evaluate((node) => {
    const frame = node.getBoundingClientRect();
    const svg = node.querySelector("svg")!.getBoundingClientRect();
    return { frameHeight: frame.height, svgHeight: svg.height };
  });
  expect(geometry.frameHeight).toBeGreaterThanOrEqual(geometry.svgHeight);
});


const sizes = [[320, 568], [360, 640], [390, 844], [430, 932], [844, 390], [1440, 1000]] as const;
test("category actions keep the shared menu layout on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lancamentos");
  await page.getByRole("tab", { name: "Categorias" }).click();
  await page.locator(".category-card .action-menu-trigger").first().click();

  const menu = page.getByRole("menu");
  const edit = page.getByRole("menuitem", { name: "Editar" });
  await expect(menu).toBeVisible();
  const geometry = await edit.evaluate((button) => {
    const item = button.getBoundingClientRect();
    const popover = button.parentElement!.getBoundingClientRect();
    const [icon, label] = Array.from(button.children).map((child) => child.getBoundingClientRect());
    return {
      itemWidth: item.width,
      popoverWidth: popover.width,
      iconCenterY: icon.y + icon.height / 2,
      labelCenterY: label.y + label.height / 2,
    };
  });
  expect(geometry.itemWidth).toBeGreaterThan(geometry.popoverWidth - 16);
  expect(Math.abs(geometry.iconCenterY - geometry.labelCenterY)).toBeLessThan(2);
});

test("a future planning occurrence can be confirmed today", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-13T15:00:00Z"));
  await page.goto("/planejamento");
  await page.locator(".planning-entry .action-menu-trigger").first().click();
  await page.getByRole("menuitem", { name: "Marcar como realizado" }).click();

  const dialog = page.getByRole("dialog", { name: "Concluir planejamento" });
  await expect(dialog.getByRole("button", { name: "Data efetiva" })).toContainText("13/09/2026");
  await dialog.getByRole("button", { name: "Concluir em 13/09/2026" }).click();
  await expect(page.locator(".planning-entry").first()).toContainText("Realizado");
  await expect(dialog).toHaveCount(0);
});
const routes = ["/resumo", "/lancamentos", "/patrimonio/instituicoes", "/planejamento", "/perfil"];
for (const [width, height] of sizes) for (const theme of ["light", "dark"]) {
  test(`${width}x${height} ${theme}: five screens and editor`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date("2026-09-13T15:00:00Z"));
    for (const route of routes) {
      await page.goto(`${route}?theme=${theme}`);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator(".loading")).toHaveCount(0);
      // Simulate an inset; navbar measurement must react to its actual new height.
      await page.addStyleTag({ content: ":root { --safe-area-bottom: 34px; }" });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const nav = page.locator(".mobile-nav");
      const checkBottom = async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        if (width <= 760) {
          await expect.poll(async () => {
            const main = await page.locator("main").boundingBox();
            const bar = await nav.boundingBox();
            return main!.y + main!.height <= bar!.y;
          }).toBe(true);
        }
      };
      await checkBottom();
      if (route === "/lancamentos") {
        await expect(page.getByText("Exibindo 25 de 30", { exact: true })).toBeVisible();
        for (const amount of await page.locator(".transaction-amount").all()) {
          expect(await amount.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
        const action = page.locator(".transaction-item .action-menu-trigger").last();
        await action.click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        const bounds = await menu.boundingBox();
        const bar = await nav.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(width <= 760 ? bar!.y : height);
        await page.keyboard.press("Escape");
      }
      if (route === "/perfil") {
        await expect(page.locator(".profile-card-mascot")).toBeVisible();
        const svg = page.locator(".profile-card-mascot svg");
        expect(await svg.getAttribute("width")).toBe("240");
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`${route.replaceAll("/", "-")}.png`), fullPage: true });
      if (route === "/perfil") {
        await page.getByRole("button", { name: "Editar personagem" }).click();
        await expect(page.getByRole("region", { name: "Editor do personagem" })).toBeVisible();
        const geometry = await page.locator(".profile-card-mascot").evaluate(el => ({ frame: el.getBoundingClientRect().height, svg: el.querySelector("svg")!.getBoundingClientRect().height }));
        expect(geometry.frame).toBeGreaterThanOrEqual(geometry.svg);
        expect(geometry.svg).toBe(280);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await checkBottom();
        await page.screenshot({ path: testInfo.outputPath("editor.png"), fullPage: true });
      }
    }
  });
}

for (const timezoneId of ["America/Recife", "UTC", "Pacific/Kiritimati"]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test("explicit months, counts, pagination and date picker", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime(new Date("2026-09-14T02:30:00Z"));
      await page.goto("/lancamentos");
      await expect(page.getByText("Exibindo 25 de 30", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Ver mais", exact: true }).click();
      await expect(page.getByText("Exibindo 30 de 30", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Período de movimentações" }).click();
      await page.getByRole("option", { name: "Selecionar mês completo" }).click();
      await expect(page.getByText("Exibindo 25 de 32", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Mês de movimentações" }).click();
      await page.getByRole("button", { name: "Out", exact: true }).click();
      await expect(page.getByText("Exibindo 1 de 1", { exact: true })).toBeVisible();
      await expect(page.locator(".transaction-copy strong")).toContainText("Compra 31");
      await page.getByRole("button", { name: "Período de movimentações" }).click();
      await page.getByRole("option", { name: "Mês atual até hoje" }).click();
      await expect(page.getByText("Exibindo 25 de 30", { exact: true })).toBeVisible();
      await page.getByPlaceholder("Buscar descrição").fill("Compra 1 com");
      await expect(page.getByText("Exibindo 1 de 1", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Novo lançamento", exact: true }).click();
      await page.getByRole("button", { name: "Data do lançamento", exact: true }).click();
      await page.getByRole("button", { name: "13", exact: true }).click();
      await expect(page.getByRole("button", { name: "Data do lançamento", exact: true })).toContainText("13/09/2026");
    });
  });
}
