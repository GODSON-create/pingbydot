// BUILD AFRICA CHALLENGE — Visitor-First Interactive Application

(function () {
  const DATA = window.SPEC_DATA;

  const state = {
    activeProduct: "ping", // 'ping' | 'dot' | 'griot'
    pingUrl: "https://justping.lovable.app/",
    dotUrl: "https://dotlive.lovable.app/",
    griotView: "blueprint", // 'blueprint' | 'tasks' | 'learning' | 'publish'
    griotLessonCompleted: false,
    griotShareApproved: false,
    griotSharePublished: false,
    openFaqIndex: 0
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  document.addEventListener("DOMContentLoaded", () => {
    renderHowItWorks();
    renderProductsShowcase();
    renderNetworkAndRetention();
    renderChallengeSection();
    renderRoadmap();
    renderFaq();
    bindHeroAndNavControls();
  });

  // =========================================================================
  // HERO & NAVIGATION CONTROLS
  // =========================================================================
  function bindHeroAndNavControls() {
    $$("[data-select-product]").forEach((el) => {
      el.addEventListener("click", () => {
        const prod = el.getAttribute("data-select-product");
        state.activeProduct = prod;
        $$(".journey-loop-pill").forEach((p) => {
          p.classList.toggle("active", p.getAttribute("data-select-product") === prod);
        });
        renderProductsShowcase();
        const section = document.getElementById("products");
        if (section) section.scrollIntoView({ behavior: "smooth" });
      });
    });

    $$("[data-product-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeProduct = btn.getAttribute("data-product-tab");
        renderProductsShowcase();
      });
    });

    $$(".primary-nav .nav-item").forEach((link) => {
      link.addEventListener("click", () => {
        $$(".primary-nav .nav-item").forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
      });
    });
  }

  // =========================================================================
  // HOW PARTICIPATION WORKS (6 Steps)
  // =========================================================================
  function renderHowItWorks() {
    const mount = $("#how-steps-mount");
    if (!mount) return;

    mount.innerHTML = DATA.howItWorks
      .map(
        (item) => `
      <article class="how-step-card">
        <div>
          <div class="how-step-top">
            <span class="how-step-number tabular">${item.step}</span>
            <span class="how-step-product">${item.product}</span>
          </div>
          <h3 class="how-step-title">${item.title}</h3>
          <p class="how-step-desc">${item.description}</p>
        </div>
      </article>
    `
      )
      .join("");
  }

  // =========================================================================
  // THE THREE PRODUCTS (Ping, DOT, GRIOT AI Live Viewports)
  // =========================================================================
  function renderProductsShowcase() {
    const product = DATA.products.find((p) => p.id === state.activeProduct) || DATA.products[0];

    $$("[data-product-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-product-tab") === product.id);
    });

    const extMount = $("#product-external-link-mount");
    if (extMount) {
      if (product.liveUrl) {
        extMount.innerHTML = `
          <a href="${product.liveUrl}" target="_blank" rel="noopener" class="header-cta" style="background:var(--accent-lime);color:var(--bg-obsidian);">
            Open ${product.liveLabel} in New Tab ↗
          </a>
        `;
      } else {
        extMount.innerHTML = `
          <span style="font-size:0.82rem;font-weight:700;color:var(--accent-lime);padding:8px 14px;border-radius:999px;background:var(--bg-graphite);border:1px solid var(--border-dark);">
            Selected Builders Workspace
          </span>
        `;
      }
    }

    const infoMount = $("#product-info-mount");
    if (infoMount) {
      infoMount.innerHTML = `
        <div>
          <span class="product-tagline-label">${product.tagline}</span>
          <h3 class="product-info-title">${product.name}</h3>
          <p class="product-info-summary">${product.summary}</p>
          <ul class="product-feature-list">
            ${product.highlights.map((h) => `<li>${h}</li>`).join("")}
          </ul>
        </div>

        <div style="padding-top:16px;border-top:1px solid var(--border-dark);font-size:0.84rem;color:var(--ink-on-dark-muted);">
          <div style="color:#FFFFFF;font-weight:700;margin-bottom:4px;">${product.networkRole}</div>
          <div>Why builders return: ${product.retentionDrivers}</div>
        </div>
      `;
    }

    const barMount = $("#live-browser-bar-mount");
    if (barMount) {
      const currentUrl =
        product.id === "ping"
          ? state.pingUrl
          : product.id === "dot"
          ? state.dotUrl
          : `griot.buildafrica.ai/${state.griotView}`;

      barMount.innerHTML = `
        <div class="window-controls" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div class="browser-address">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentUrl}</span>
          ${
            product.liveUrl
              ? `<a href="${currentUrl}" target="_blank" rel="noopener" style="color:var(--accent-lime);text-decoration:none;font-weight:700;">Live ↗</a>`
              : `<span style="color:var(--accent-lime);">Interactive Preview</span>`
          }
        </div>
        <div class="quick-route-pills">
          ${product.quickRoutes
            .map((r) => {
              const isActive =
                product.id === "ping"
                  ? state.pingUrl === r.url
                  : product.id === "dot"
                  ? state.dotUrl === r.url
                  : state.griotView === r.view;
              return `
                <button type="button" class="route-pill ${isActive ? "active" : ""}" data-route-url="${r.url || ""}" data-route-view="${r.view || ""}">
                  ${r.label}
                </button>
              `;
            })
            .join("")}
        </div>
      `;

      $$("[data-route-url]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const url = btn.getAttribute("data-route-url");
          const view = btn.getAttribute("data-route-view");
          if (product.id === "ping" && url) state.pingUrl = url;
          if (product.id === "dot" && url) state.dotUrl = url;
          if (product.id === "griot" && view) state.griotView = view;
          renderProductsShowcase();
        });
      });
    }

    const viewportMount = $("#live-viewport-mount");
    if (viewportMount) {
      if (product.id === "ping" || product.id === "dot") {
        const targetUrl = product.id === "ping" ? state.pingUrl : state.dotUrl;
        const existingIframe = viewportMount.querySelector("iframe.live-iframe");
        if (existingIframe && existingIframe.getAttribute("src") === targetUrl) {
          return;
        }
        viewportMount.innerHTML = `
          <iframe
            class="live-iframe"
            src="${targetUrl}"
            title="${product.name} Live Product View"
            loading="lazy"
          ></iframe>
        `;
      } else {
        viewportMount.innerHTML = buildGriotWorkspacePreview();
        bindGriotPreviewEvents();
      }
    }
  }

  function buildGriotWorkspacePreview() {
    return `
      <div style="height:100%;padding:24px;background:#0B0E0D;color:#F5F4EE;display:flex;flex-direction:column;justify-content:space-between;overflow-y:auto;">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid #252D28;margin-bottom:18px;">
            <div>
              <div style="font-size:0.75rem;color:var(--accent-lime);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">
                GRIOT AI Execution Workspace • Solar Cold-Chain Project
              </div>
              <h4 style="font-size:1.25rem;font-weight:800;margin-top:2px;">
                ${
                  state.griotView === "blueprint"
                    ? "1. Structure Your Project Blueprint"
                    : state.griotView === "tasks"
                    ? "2. Organise Tasks, Schedules & Track Milestones"
                    : state.griotView === "learning"
                    ? "3. Connected DOT Learning Progress"
                    : "4. Approved Progress Sharing to Ping"
                }
              </h4>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="route-pill ${state.griotView === "blueprint" ? "active" : ""}" data-griot-tab="blueprint">Blueprint</button>
              <button type="button" class="route-pill ${state.griotView === "tasks" ? "active" : ""}" data-griot-tab="tasks">Tasks & Schedule</button>
              <button type="button" class="route-pill ${state.griotView === "learning" ? "active" : ""}" data-griot-tab="learning">DOT Learning Sync</button>
              <button type="button" class="route-pill ${state.griotView === "publish" ? "active" : ""}" data-griot-tab="publish">Publish to Ping</button>
            </div>
          </div>

          ${
            state.griotView === "blueprint"
              ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
              <div style="background:#151A17;border:1px solid #252D28;border-radius:14px;padding:18px;">
                <div style="font-size:0.76rem;color:#A2ABA5;margin-bottom:4px;">Project Objective</div>
                <div style="font-size:0.98rem;font-weight:700;margin-bottom:10px;">
                  Deploy off-grid solar cold-storage hubs for smallholder farming cooperatives.
                </div>
                <div style="font-size:0.84rem;color:#A2ABA5;">
                  GRIOT AI helps selected builders turn an idea into structured workstreams, tasks, schedules, and milestones before execution begins.
                </div>
              </div>
              <div style="background:#151A17;border:1px solid #252D28;border-radius:14px;padding:18px;">
                <div style="font-size:0.76rem;color:var(--accent-lime);font-weight:700;margin-bottom:8px;">Active Workstreams</div>
                <div style="display:flex;flex-direction:column;gap:8px;font-size:0.86rem;">
                  <div style="padding:8px 10px;background:#0B0E0D;border-radius:8px;">✓ 1. Cooperative Customer Validation (Completed)</div>
                  <div style="padding:8px 10px;background:#0B0E0D;border-radius:8px;border-left:2px solid var(--accent-lime);">→ 2. Pilot Unit Economics & Pricing Model (In Progress)</div>
                  <div style="padding:8px 10px;background:#0B0E0D;border-radius:8px;color:#A2ABA5;">• 3. Field Prototype Installation & Testing (Scheduled)</div>
                </div>
              </div>
            </div>
          `
              : state.griotView === "tasks"
              ? `
            <div style="background:#151A17;border:1px solid #252D28;border-radius:14px;padding:18px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <strong style="font-size:1.02rem;">Current Task: Validate 20 Cooperative Storage Interviews</strong>
                <span style="font-size:0.78rem;padding:4px 10px;border-radius:999px;background:#064E3B;color:#D7F5E8;font-weight:700;">
                  Evidence-Based Execution
                </span>
              </div>
              <p style="font-size:0.88rem;color:#A2ABA5;margin-bottom:14px;">
                Each task explains what needs to be done, why it matters, how to approach it, and what deliverable is expected. Your execution history reflects real recorded work.
              </p>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:0.84rem;">
                <div style="background:#0B0E0D;padding:12px;border-radius:10px;">
                  <div style="color:#A2ABA5;font-size:0.75rem;">Completed Milestones</div>
                  <div style="font-size:1.1rem;font-weight:800;margin-top:2px;">3 Milestones</div>
                </div>
                <div style="background:#0B0E0D;padding:12px;border-radius:10px;">
                  <div style="color:#A2ABA5;font-size:0.75rem;">Active Task Status</div>
                  <div style="font-size:1.1rem;font-weight:800;color:var(--accent-lime);margin-top:2px;">In Review</div>
                </div>
                <div style="background:#0B0E0D;padding:12px;border-radius:10px;">
                  <div style="color:#A2ABA5;font-size:0.75rem;">Execution History</div>
                  <div style="font-size:0.9rem;font-weight:700;margin-top:4px;">Verified Deliverables</div>
                </div>
              </div>
            </div>
          `
              : state.griotView === "learning"
              ? `
            <div style="background:#151A17;border:1px solid #252D28;border-radius:14px;padding:18px;">
              <div style="font-size:0.78rem;color:var(--gold-500);font-weight:700;margin-bottom:6px;">
                CONNECTED LEARNING WITH DOT
              </div>
              <h5 style="font-size:1.05rem;font-weight:800;margin-bottom:8px;">
                DOT develops knowledge; GRIOT AI helps you apply it to your project
              </h5>
              <p style="font-size:0.88rem;color:#A2ABA5;margin-bottom:14px;">
                ${
                  state.griotLessonCompleted
                    ? "✓ You completed the 'Customer Validation & Market Demand' lesson on DOT. Your progress is synced so you can apply it directly to your project task."
                    : "When a knowledge gap appears while planning or executing a task, GRIOT AI recommends the exact lesson on DOT."
                }
              </p>
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button type="button" class="route-pill active" id="btn-griot-complete-lesson" style="padding:8px 14px;">
                  ${state.griotLessonCompleted ? "Reset Learning Simulation" : "Simulate Completing Lesson on DOT ✓"}
                </button>
                <button type="button" class="route-pill" id="btn-griot-switch-to-dot" style="padding:8px 14px;">
                  Open DOT Live (dotlive.lovable.app) →
                </button>
              </div>
            </div>
          `
              : `
            <div style="background:#151A17;border:1px solid #252D28;border-radius:14px;padding:18px;">
              <div style="font-size:0.78rem;color:var(--accent-lime);font-weight:700;margin-bottom:6px;">
                APPROVED PROGRESS SHARING TO PING
              </div>
              <h5 style="font-size:1.05rem;font-weight:800;margin-bottom:8px;">
                Share completed milestones with the Ping community when you choose
              </h5>
              <p style="font-size:0.88rem;color:#A2ABA5;margin-bottom:14px;">
                Private documents and AI conversations stay private. You approve every milestone summary before it is published to Ping.
              </p>
              <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;margin-bottom:12px;cursor:pointer;">
                <input type="checkbox" id="chk-griot-approve-share" ${state.griotShareApproved ? "checked" : ""}>
                <span>Approve sharing Milestone 3 ("12 Rural Cold-Storage Pilot Interviews Completed") on Ping</span>
              </label>
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button type="button" class="route-pill ${state.griotShareApproved ? "active" : ""}" id="btn-griot-share-ping" style="padding:8px 14px;" ${!state.griotShareApproved ? "disabled style='opacity:0.45;cursor:not-allowed;'" : ""}>
                  ${state.griotSharePublished ? "✓ Shared to Ping Community" : "Share Approved Milestone to Ping"}
                </button>
                <button type="button" class="route-pill" id="btn-griot-switch-to-ping" style="padding:8px 14px;">
                  Open Ping Live (justping.lovable.app) →
                </button>
              </div>
            </div>
          `
          }
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid #252D28;font-size:0.8rem;color:#A2ABA5;flex-wrap:wrap;gap:8px;">
          <span>Shared Identity: Permanent DOT ID</span>
          <span>Ping → DOT → GRIOT AI → Ping</span>
        </div>
      </div>
    `;
  }

  function bindGriotPreviewEvents() {
    $$("[data-griot-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.griotView = btn.getAttribute("data-griot-tab");
        renderProductsShowcase();
      });
    });

    const lessonBtn = $("#btn-griot-complete-lesson");
    if (lessonBtn) {
      lessonBtn.addEventListener("click", () => {
        state.griotLessonCompleted = !state.griotLessonCompleted;
        renderProductsShowcase();
      });
    }

    const switchDotBtn = $("#btn-griot-switch-to-dot");
    if (switchDotBtn) {
      switchDotBtn.addEventListener("click", () => {
        state.activeProduct = "dot";
        renderProductsShowcase();
      });
    }

    const chkShare = $("#chk-griot-approve-share");
    if (chkShare) {
      chkShare.addEventListener("change", (e) => {
        state.griotShareApproved = e.target.checked;
        if (!state.griotShareApproved) state.griotSharePublished = false;
        renderProductsShowcase();
      });
    }

    const shareBtn = $("#btn-griot-share-ping");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => {
        if (state.griotShareApproved) {
          state.griotSharePublished = true;
          renderProductsShowcase();
        }
      });
    }

    const switchPingBtn = $("#btn-griot-switch-to-ping");
    if (switchPingBtn) {
      switchPingBtn.addEventListener("click", () => {
        state.activeProduct = "ping";
        renderProductsShowcase();
      });
    }
  }

  // =========================================================================
  // NETWORK STRATEGY & RETENTION / SUCCESS
  // =========================================================================
  function renderNetworkAndRetention() {
    const mount = $("#network-strategy-mount");
    if (!mount) return;

    const N = DATA.networkStrategy;
    const R = DATA.retentionAndSuccess;

    mount.innerHTML = `
      <!-- Three Connected Products Roles -->
      <div class="steps-six-grid" style="margin-bottom:24px;">
        ${N.pillars
          .map(
            (p) => `
          <article class="how-step-card">
            <div>
              <span class="how-step-product" style="display:inline-block;margin-bottom:12px;">${p.product}</span>
              <h3 class="how-step-title">${p.role}</h3>
              <p class="how-step-desc">${p.detail}</p>
            </div>
          </article>
        `
          )
          .join("")}
      </div>

      <!-- How the Experience Connects + Why Builders Return -->
      <div class="challenge-bento-grid" style="margin-bottom:24px;">
        <article class="challenge-box">
          <h3>What Connects the Experience</h3>
          <p>${N.summary}</p>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;font-size:0.92rem;">
            ${N.bridges
              .map(
                (b) => `
              <li style="padding:10px 14px;background:var(--bg-soft);border-radius:10px;border:1px solid var(--border-light);">
                ✓ ${b}
              </li>
            `
              )
              .join("")}
          </ul>
        </article>

        <article class="challenge-box">
          <h3>${R.retentionHeadline}</h3>
          <p>Each product gives builders clear, ongoing reasons to return and keep making progress:</p>
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${R.retentionItems
              .map(
                (item) => `
              <div style="padding:12px 16px;background:var(--bg-soft);border-radius:12px;border:1px solid var(--border-light);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                  <strong style="font-size:0.98rem;color:var(--ink-primary);">${item.product}</strong>
                  <span style="font-size:0.78rem;font-weight:700;color:var(--emerald-700);">${item.focus}</span>
                </div>
                <div style="font-size:0.9rem;color:var(--ink-secondary);">${item.features}</div>
              </div>
            `
              )
              .join("")}
          </div>
        </article>
      </div>

      <!-- Programme Success Definition (100M Reach Objective) -->
      <article class="challenge-box">
        <h3>${R.successHeadline}</h3>
        <p>Our one-year objective is to bring 100 million people into one connected builder network where discovery, learning, and project execution reinforce each other.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
          ${R.successMetrics
            .map(
              (m) => `
            <div style="padding:18px;background:var(--emerald-50);border:1px solid var(--emerald-100);border-radius:14px;">
              <div style="font-size:0.78rem;font-weight:800;text-transform:uppercase;color:var(--emerald-900);margin-bottom:4px;">
                ${m.label}
              </div>
              <div class="mono tabular" style="font-size:1.65rem;font-weight:800;color:var(--emerald-900);margin-bottom:6px;">
                ${m.value}
              </div>
              <div style="font-size:0.86rem;color:var(--ink-secondary);line-height:1.45;">
                ${m.detail}
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </article>
    `;
  }

  // =========================================================================
  // THE CHALLENGE SECTION
  // =========================================================================
  function renderChallengeSection() {
    const mount = $("#challenge-mount");
    if (!mount) return;

    const C = DATA.challengePillars;

    mount.innerHTML = `
      <!-- Participation Requirements -->
      <article class="challenge-box">
        <h3>${C.participation.title}</h3>
        <p>${C.participation.summary}</p>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:10px;font-size:0.92rem;">
          ${C.participation.points
            .map(
              (pt) => `
            <li style="padding:10px 14px;background:var(--bg-soft);border-radius:10px;border:1px solid var(--border-light);">
              ✓ ${pt}
            </li>
          `
            )
            .join("")}
        </ul>
      </article>

      <!-- Account Verification Information -->
      <article class="challenge-box">
        <h3>${C.verification.title}</h3>
        <p>${C.verification.summary}</p>
        <div class="tier-cards-row">
          ${C.verification.tiers
            .map(
              (t) => `
            <div class="ver-tier-card">
              <div style="font-weight:800;font-size:0.95rem;margin-bottom:4px;">${t.name}</div>
              <div class="mono tabular" style="font-size:1.15rem;font-weight:800;color:var(--emerald-700);margin-bottom:6px;">
                ${t.price}
              </div>
              <div style="font-size:0.82rem;color:var(--ink-secondary);line-height:1.4;">${t.detail}</div>
            </div>
          `
            )
            .join("")}
        </div>
      </article>

      <!-- Progressive, Tiered DOT Credit Rewards -->
      <article class="challenge-box full-span">
        <h3>${C.rewards.title}</h3>
        <p>${C.rewards.summary}</p>
        <div class="reward-stages-grid">
          ${C.rewards.tiers
            .map(
              (rt) => `
            <div class="reward-stage-card">
              <div class="mono" style="font-size:0.76rem;font-weight:700;color:var(--emerald-700);margin-bottom:4px;">
                ${rt.tier}
              </div>
              <div style="font-weight:800;font-size:1rem;margin-bottom:6px;">${rt.name}</div>
              <div style="font-size:0.84rem;color:var(--ink-secondary);line-height:1.45;">${rt.condition}</div>
            </div>
          `
            )
            .join("")}
        </div>
      </article>

      <!-- GRIOT AI Eligibility & Merit-Based Selection -->
      <article class="challenge-box">
        <h3>${C.griotSelection.title}</h3>
        <p>${C.griotSelection.summary}</p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${C.griotSelection.gates
            .map(
              (g) => `
            <div style="padding:14px 16px;background:var(--emerald-50);border:1px solid var(--emerald-100);border-radius:12px;">
              <strong style="display:block;font-size:0.95rem;color:var(--emerald-900);margin-bottom:4px;">${g.gate}</strong>
              <span style="font-size:0.88rem;color:var(--ink-secondary);">${g.detail}</span>
            </div>
          `
            )
            .join("")}
        </div>
      </article>

      <!-- Editorial Spotlight -->
      <article class="challenge-box">
        <h3>${C.spotlight.title}</h3>
        <p>${C.spotlight.summary}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${C.spotlight.criteria
            .map(
              (cr) => `
            <div style="padding:12px 14px;background:var(--bg-soft);border:1px solid var(--border-light);border-radius:10px;font-size:0.88rem;font-weight:600;">
              • ${cr}
            </div>
          `
            )
            .join("")}
        </div>
      </article>
    `;
  }

  // =========================================================================
  // ROADMAP (5 Plain-Language Steps)
  // =========================================================================
  function renderRoadmap() {
    const mount = $("#roadmap-mount");
    if (!mount) return;

    mount.innerHTML = DATA.roadmap
      .map(
        (item) => `
      <article class="roadmap-item">
        <span class="roadmap-step-badge tabular">Stage 0${item.step}</span>
        <h3>${item.title}</h3>
        <p>${item.description}</p>
      </article>
    `
      )
      .join("");
  }

  // =========================================================================
  // FAQ SECTION
  // =========================================================================
  function renderFaq() {
    const mount = $("#faq-mount");
    if (!mount) return;

    mount.innerHTML = DATA.faqs
      .map(
        (item, idx) => `
      <div class="faq-item ${state.openFaqIndex === idx ? "open" : ""}">
        <button type="button" class="faq-question-btn" data-faq-idx="${idx}">
          <span>${item.q}</span>
          <span class="mono" style="color:var(--emerald-700);font-size:1.1rem;">
            ${state.openFaqIndex === idx ? "−" : "+"}
          </span>
        </button>
        <div class="faq-answer">
          ${item.a}
        </div>
      </div>
    `
      )
      .join("");

    $$("[data-faq-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-faq-idx"));
        state.openFaqIndex = state.openFaqIndex === idx ? -1 : idx;
        renderFaq();
      });
    });
  }
})();
