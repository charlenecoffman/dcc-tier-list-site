const API_ENDPOINT = "https://dungeon-crawler-carl.fandom.com/api.php";
const CATEGORY_TITLE = "Category:Characters";
const STORAGE_KEY = "dcc-tier-maker-state-v1";
const DETAIL_BATCH_SIZE = 20;
const MAX_RETRIES = 4;

const ignoredTitlePrefixes = ["Category:", "Template:", "File:", "Help:"];
const ignoredFilterCategories = new Set(["Characters", "Needs photo", "Stubs"]);
const tierKeys = ["S", "A", "B", "C", "D", "F"] as const;

type TierKey = (typeof tierKeys)[number];
type ZoneKey = TierKey | "pool";
type CharacterId = string;

type TierState = {
  version: 1;
  updatedAt: string;
  tiers: Record<TierKey, CharacterId[]>;
};

type SharedTierPayload = {
  v: 1;
  t: Partial<Record<TierKey, CharacterId[]>>;
};

type CategoryMember = {
  pageid?: number;
  ns?: number;
  title?: string;
  type?: string;
};

type CategoryApiResponse = ApiResponseBase & {
  continue?: Record<string, string>;
  query?: {
    categorymembers?: CategoryMember[];
  };
};

type PageImage = {
  source?: string;
  width?: number;
  height?: number;
};

type RevisionSlot = {
  content?: string;
  "*": string | undefined;
};

type Revision = {
  content?: string;
  "*": string | undefined;
  slots?: {
    main?: RevisionSlot;
  };
};

type DetailPage = {
  pageid?: number;
  ns?: number;
  title?: string;
  missing?: boolean;
  fullurl?: string;
  canonicalurl?: string;
  thumbnail?: PageImage;
  original?: PageImage;
  revisions?: Revision[];
  categories?: PageCategory[];
};

type DetailsApiResponse = ApiResponseBase & {
  query?: {
    pages?: DetailPage[];
  };
};

type ApiResponseBase = {
  error?: {
    code?: string;
    info?: string;
  };
  warnings?: Record<string, unknown>;
};

type PageCategory = {
  title?: string;
};

type Character = {
  id: CharacterId;
  name: string;
  pageUrl: string;
  summary: string;
  imageUrl: string;
  categories: string[];
};

type CategoryFilter = {
  name: string;
  count: number;
  isDirectCharacterCategory: boolean;
};

type PointerDrag = {
  id: CharacterId;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  sourceCard: HTMLElement;
  ghost: HTMLElement | null;
};

type DropTarget = {
  zoneKey: ZoneKey;
  targetId: CharacterId | null;
  insertAfter: boolean;
};

type LoadStats = {
  apiPages: number;
  categoryMembers: number;
  uniqueCharacters: number;
};

const tierColors: Record<TierKey, string> = {
  S: "#e2b54e",
  A: "#dd6d55",
  B: "#6cbf7e",
  C: "#58a8b2",
  D: "#9d7cd8",
  F: "#8d8a80"
};

const statusText = requireElement<HTMLElement>("statusText");
const poolCount = requireElement<HTMLElement>("poolCount");
const rankedCount = requireElement<HTMLElement>("rankedCount");
const poolPanel = requireElement<HTMLElement>("poolPanel");
const poolZone = requireElement<HTMLElement>("poolZone");
const tierBoard = requireElement<HTMLElement>("tierBoard");
const detailsContent = requireElement<HTMLElement>("detailsContent");
const searchInput = requireElement<HTMLInputElement>("searchInput");
const categorySelect = requireElement<HTMLSelectElement>("categorySelect");
const selectedCategoryList = requireElement<HTMLElement>("selectedCategoryList");
const openPickerButton = requireElement<HTMLButtonElement>("openPickerButton");
const closePickerButton = requireElement<HTMLButtonElement>("closePickerButton");
const pickerBackdrop = requireElement<HTMLElement>("pickerBackdrop");
const placementBar = requireElement<HTMLElement>("placementBar");
const placementName = requireElement<HTMLElement>("placementName");
const cancelPlacementButton = requireElement<HTMLButtonElement>("cancelPlacementButton");
const refreshButton = requireElement<HTMLButtonElement>("refreshButton");
const shareButton = requireElement<HTMLButtonElement>("shareButton");
const downloadButton = requireElement<HTMLButtonElement>("downloadButton");
const resetButton = requireElement<HTMLButtonElement>("resetButton");
const resetDialog = requireElement<HTMLDialogElement>("resetDialog");
const cancelResetButton = requireElement<HTMLButtonElement>("cancelResetButton");
const confirmResetButton = requireElement<HTMLButtonElement>("confirmResetButton");
const mobileDetailsDialog = requireElement<HTMLDialogElement>("mobileDetailsDialog");
const mobileDetailsContent = requireElement<HTMLElement>("mobileDetailsContent");
const closeMobileDetailsButton = requireElement<HTMLButtonElement>("closeMobileDetailsButton");
const shareNotice = requireElement<HTMLElement>("shareNotice");
const saveSharedButton = requireElement<HTMLButtonElement>("saveSharedButton");
const restoreLocalButton = requireElement<HTMLButtonElement>("restoreLocalButton");
const shareLinkPanel = requireElement<HTMLElement>("shareLinkPanel");
const shareLinkInput = requireElement<HTMLInputElement>("shareLinkInput");
const copyShareLinkButton = requireElement<HTMLButtonElement>("copyShareLinkButton");
const cardTemplate = requireElement<HTMLTemplateElement>("characterCardTemplate");
const mobileExperienceQuery = window.matchMedia("(max-width: 820px)");

let characterMap = new Map<CharacterId, Character>();
let characters: Character[] = [];
let categoryFilters: CategoryFilter[] = [];
let state: TierState = createEmptyState();
let selectedId: CharacterId | null = null;
let activeCategoryFilters: string[] = [];
let draggedId: CharacterId | null = null;
let pointerDrag: PointerDrag | null = null;
let suppressNextClickId: CharacterId | null = null;
let pendingPlacementId: CharacterId | null = null;
let isPickerOpen = false;
let loadStats: LoadStats = {
  apiPages: 0,
  categoryMembers: 0,
  uniqueCharacters: 0
};
let localStateBeforeSharedTier: TierState | null = null;
let viewingSharedTier = false;
let mobileDetailsReturnFocus: HTMLElement | null = null;

bindEvents();
renderEmptyBoard();
void initialize();

async function initialize(): Promise<void> {
  const sharedState = readSharedStateFromLocation();
  const localState = loadLocalState();

  try {
    document.body.classList.add("is-loading");
    setStatus("Loading live wiki data...");

    const loaded = await loadCharacters();
    characters = loaded.characters;
    categoryFilters = loaded.categoryFilters;
    characterMap = new Map(characters.map((character) => [character.id, character]));
    loadStats = loaded.stats;

    if (sharedState) {
      localStateBeforeSharedTier = localState;
      state = reconcileState(sharedState);
      viewingSharedTier = true;
      shareNotice.hidden = false;
      setStatus(`Viewing shared tier with ${characters.length} live characters.`);
    } else {
      state = reconcileState(localState ?? createEmptyState());
      saveLocalState();
      setStatus(`Loaded ${characters.length} live characters from the wiki.`);
    }

    selectedId = firstAvailableCharacterId();
    render();
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Could not load character data.");
    renderLoadError(error);
  } finally {
    document.body.classList.remove("is-loading");
  }
}

function bindEvents(): void {
  attachDropZone(poolZone);

  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerCancel);

  mobileExperienceQuery.addEventListener("change", syncMobileExperience);

  openPickerButton.addEventListener("click", () => {
    setCharacterPickerOpen(true);
  });

  closePickerButton.addEventListener("click", () => {
    setCharacterPickerOpen(false);
  });

  pickerBackdrop.addEventListener("click", () => {
    setCharacterPickerOpen(false);
  });

  resetDialog.addEventListener("click", (event) => {
    if (event.target === resetDialog) {
      closeResetDialog();
    }
  });

  resetDialog.addEventListener("close", () => {
    resetButton.focus();
  });

  mobileDetailsDialog.addEventListener("click", (event) => {
    if (event.target === mobileDetailsDialog) {
      closeMobileDetailsDialog();
    }
  });

  mobileDetailsDialog.addEventListener("close", () => {
    mobileDetailsContent.replaceChildren();

    if (mobileDetailsReturnFocus?.isConnected) {
      mobileDetailsReturnFocus.focus();
    }

    mobileDetailsReturnFocus = null;
  });

  closeMobileDetailsButton.addEventListener("click", () => {
    closeMobileDetailsDialog();
  });

  cancelPlacementButton.addEventListener("click", () => {
    clearPendingPlacement();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (resetDialog.open) {
      return;
    }

    if (mobileDetailsDialog.open) {
      return;
    }

    if (isPickerOpen) {
      setCharacterPickerOpen(false);
      return;
    }

    if (pendingPlacementId) {
      clearPendingPlacement();
    }
  });

  searchInput.addEventListener("input", () => {
    render();
  });

  categorySelect.addEventListener("change", () => {
    addCategoryFilter(categorySelect.value);
  });

  refreshButton.addEventListener("click", () => {
    void refreshCharacters();
  });

  shareButton.addEventListener("click", () => {
    void shareTier();
  });

  downloadButton.addEventListener("click", () => {
    void downloadTierImage();
  });

  resetButton.addEventListener("click", () => {
    openResetDialog();
  });

  cancelResetButton.addEventListener("click", () => {
    closeResetDialog();
  });

  confirmResetButton.addEventListener("click", () => {
    closeResetDialog();
    resetTierList();
  });

  saveSharedButton.addEventListener("click", () => {
    viewingSharedTier = false;
    shareNotice.hidden = true;
    shareLinkPanel.hidden = true;
    clearHash();
    saveLocalState();
    setStatus("Shared tier saved to this browser.");
  });

  restoreLocalButton.addEventListener("click", () => {
    viewingSharedTier = false;
    shareNotice.hidden = true;
    shareLinkPanel.hidden = true;
    clearHash();
    state = reconcileState(localStateBeforeSharedTier ?? createEmptyState());
    selectedId = firstAvailableCharacterId();
    pendingPlacementId = null;
    render();
    setStatus("Local tier restored.");
  });

  copyShareLinkButton.addEventListener("click", () => {
    void copyShareLinkFromInput();
  });

  syncMobileExperience();
}

function addCategoryFilter(category: string): void {
  const nextCategory = category.trim();
  categorySelect.value = "";

  if (!nextCategory || activeCategoryFilters.includes(nextCategory)) {
    return;
  }

  activeCategoryFilters = [...activeCategoryFilters, nextCategory];
  render();
}

function removeCategoryFilter(category: string): void {
  activeCategoryFilters = activeCategoryFilters.filter((selectedCategory) => selectedCategory !== category);
  render();
  categorySelect.focus();
}

function openResetDialog(): void {
  if (resetDialog.open) {
    return;
  }

  resetDialog.showModal();

  window.setTimeout(() => {
    cancelResetButton.focus();
  }, 0);
}

function closeResetDialog(): void {
  if (resetDialog.open) {
    resetDialog.close();
  }
}

function openMobileDetailsDialog(id: CharacterId, returnFocus: HTMLElement): void {
  if (!isMobileExperience()) {
    selectCharacter(id);
    return;
  }

  const character = characterMap.get(id);

  if (!character) {
    return;
  }

  selectedId = id;
  renderDetails();
  updateSelectedCharacterCards(id);
  mobileDetailsReturnFocus = returnFocus;
  mobileDetailsContent.replaceChildren(...createCharacterDetailsContent(character, "mobileDetailsTitle"));

  if (!mobileDetailsDialog.open) {
    mobileDetailsDialog.showModal();
  }

  window.setTimeout(() => {
    closeMobileDetailsButton.focus();
  }, 0);
}

function closeMobileDetailsDialog(): void {
  if (mobileDetailsDialog.open) {
    mobileDetailsDialog.close();
  }
}

function resetTierList(): void {
  state = createEmptyState();
  selectedId = firstAvailableCharacterId();
  pendingPlacementId = null;
  setCharacterPickerOpen(false);
  viewingSharedTier = false;
  shareNotice.hidden = true;
  shareLinkPanel.hidden = true;
  clearHash();
  saveLocalState();
  render();
  setStatus("Tier list reset.");
}

async function refreshCharacters(): Promise<void> {
  try {
    document.body.classList.add("is-loading");
    setStatus("Refreshing live wiki data...");

    const existingState = cloneState(state);
    const loaded = await loadCharacters();
    characters = loaded.characters;
    categoryFilters = loaded.categoryFilters;
    characterMap = new Map(characters.map((character) => [character.id, character]));
    loadStats = loaded.stats;
    state = reconcileState(existingState);
    activeCategoryFilters = activeCategoryFilters.filter((category) =>
      categoryFilters.some((filter) => filter.name === category)
    );

    if (!characterMap.has(selectedId ?? "")) {
      selectedId = firstAvailableCharacterId();
    }

    if (!viewingSharedTier) {
      saveLocalState();
    }

    render();
    setStatus(`Refreshed ${characters.length} live characters.`);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Refresh failed.");
  } finally {
    document.body.classList.remove("is-loading");
  }
}

async function loadCharacters(): Promise<{ characters: Character[]; categoryFilters: CategoryFilter[]; stats: LoadStats }> {
  const categoryResult = await fetchCategoryMembers();
  const directCharacterCategories = new Set(
    categoryResult.members
      .map((member) => member.title?.trim() ?? "")
      .filter((title) => title.startsWith("Category:"))
      .map(stripCategoryPrefix)
      .filter((category) => category.length > 0)
  );
  const uniqueTitles = Array.from(
    new Set(
      categoryResult.members
        .map((member) => member.title?.trim() ?? "")
        .filter((title) => title.length > 0 && !shouldIgnoreTitle(title))
    )
  );

  const detailMap = new Map<CharacterId, Character>();
  const batches = chunk(uniqueTitles, DETAIL_BATCH_SIZE);

  for (let index = 0; index < batches.length; index += 1) {
    setStatus(`Loading details ${index + 1} of ${batches.length}...`);
    const pages = await fetchDetailsBatch(batches[index]);

    for (const page of pages) {
      if (page.missing || !page.pageid || !page.title || shouldIgnoreTitle(page.title)) {
        continue;
      }

      const id = String(page.pageid);
      const character: Character = {
        id,
        name: page.title,
        pageUrl: page.fullurl ?? page.canonicalurl ?? wikiUrlForTitle(page.title),
        summary: extractFirstSentenceFromWikitext(getRevisionContent(page) ?? ""),
        imageUrl: page.original?.source ?? page.thumbnail?.source ?? "",
        categories: getPageCategories(page)
      };

      detailMap.set(id, character);
    }
  }

  const sortedCharacters = Array.from(detailMap.values()).sort(compareCharactersByName);

  return {
    characters: sortedCharacters,
    categoryFilters: getCategoryFilters(sortedCharacters, directCharacterCategories),
    stats: {
      apiPages: categoryResult.apiPages,
      categoryMembers: categoryResult.members.length,
      uniqueCharacters: sortedCharacters.length
    }
  };
}

async function fetchCategoryMembers(): Promise<{ members: CategoryMember[]; apiPages: number }> {
  const members: CategoryMember[] = [];
  let apiPages = 0;
  let continuation: Record<string, string> | undefined;

  do {
    const response = await fetchJson<CategoryApiResponse>({
      action: "query",
      list: "categorymembers",
      cmtitle: CATEGORY_TITLE,
      cmlimit: "max",
      cmprop: "ids|title|type",
      format: "json",
      formatversion: "2",
      ...(continuation ?? {})
    });

    apiPages += 1;
    const pageMembers = response.query?.categorymembers ?? [];
    members.push(...pageMembers);
    setStatus(`Loaded category page ${apiPages}; ${members.length} members...`);
    continuation = response.continue;
  } while (continuation);

  return { members, apiPages };
}

async function fetchDetailsBatch(titles: string[]): Promise<DetailPage[]> {
  const response = await fetchJson<DetailsApiResponse>({
    action: "query",
    prop: "revisions|pageimages|info|categories",
    inprop: "url",
    rvprop: "content",
    rvslots: "main",
    rvsection: "0",
    cllimit: "max",
    clshow: "!hidden",
    piprop: "thumbnail|original",
    pithumbsize: "260",
    redirects: "1",
    titles: titles.join("|"),
    format: "json",
    formatversion: "2"
  });

  return response.query?.pages ?? [];
}

async function fetchJson<T extends ApiResponseBase>(parameters: Record<string, string>): Promise<T> {
  const url = new URL(API_ENDPOINT);

  for (const [key, value] of Object.entries({ origin: "*", ...parameters })) {
    url.searchParams.set(key, value);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (isTransientStatus(response.status) && attempt < MAX_RETRIES) {
        await delay(getRetryDelay(response, attempt));
        continue;
      }

      if (!response.ok) {
        throw new Error(`MediaWiki HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as T;

      if (data.error) {
        throw new Error(`MediaWiki API error ${data.error.code ?? "unknown"}: ${data.error.info ?? "No details"}`);
      }

      if (data.warnings) {
        console.warn("MediaWiki warnings", data.warnings);
      }

      return data;
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_RETRIES) {
        break;
      }

      await delay(getBackoffDelay(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("MediaWiki request failed.");
}

function render(): void {
  if (pendingPlacementId && !characterMap.has(pendingPlacementId)) {
    pendingPlacementId = null;
  }

  renderTierBoard();
  renderCategorySelect();
  renderPool();
  renderCounts();
  renderDetails();
  renderMobileControls();
}

function renderEmptyBoard(): void {
  tierBoard.replaceChildren(
    ...tierKeys.map((tier) => {
      const row = document.createElement("section");
      row.className = "tier-row";

      const label = document.createElement("div");
      label.className = "tier-label";
      label.textContent = tier;
      label.style.background = tierColors[tier];

      const dropZone = document.createElement("div");
      dropZone.className = "drop-zone tier-drop";
      dropZone.dataset.zone = tier;

      row.addEventListener("click", (event) => {
        handleTierRowPlacement(event, tier);
      });

      row.append(label, dropZone);
      return row;
    })
  );
}

function renderTierBoard(): void {
  const fragment = document.createDocumentFragment();

  for (const tier of tierKeys) {
    const row = document.createElement("section");
    row.className = "tier-row";
    row.addEventListener("click", (event) => {
      handleTierRowPlacement(event, tier);
    });

    const label = document.createElement("div");
    label.className = "tier-label";
    label.textContent = tier;
    label.style.background = tierColors[tier];

    const dropZone = document.createElement("div");
    dropZone.className = "drop-zone tier-drop";
    dropZone.dataset.zone = tier;
    attachDropZone(dropZone);

    for (const id of state.tiers[tier]) {
      const character = characterMap.get(id);

      if (character) {
        dropZone.append(createCharacterCard(character));
      }
    }

    row.append(label, dropZone);
    fragment.append(row);
  }

  tierBoard.replaceChildren(fragment);
}

function renderPool(): void {
  const poolCharacters = getVisiblePoolCharacters();

  const fragment = document.createDocumentFragment();

  for (const character of poolCharacters) {
    fragment.append(createCharacterCard(character));
  }

  poolZone.replaceChildren(fragment);
}

function renderCategorySelect(): void {
  const unrankedCharacters = getUnrankedCharacters();
  const unrankedCategoryCounts = countCategories(unrankedCharacters);
  const selectedCategorySet = new Set(activeCategoryFilters);
  const directGroup = document.createElement("optgroup");
  const otherGroup = document.createElement("optgroup");
  const allOption = document.createElement("option");

  directGroup.label = "Character categories";
  otherGroup.label = "Other wiki tags";
  allOption.value = "";
  allOption.textContent = activeCategoryFilters.length > 0
    ? "Add another category..."
    : `All categories (${unrankedCharacters.length})`;

  for (const filter of categoryFilters) {
    const count = unrankedCategoryCounts.get(filter.name) ?? 0;

    if (selectedCategorySet.has(filter.name) || count === 0) {
      continue;
    }

    const option = document.createElement("option");
    option.value = filter.name;
    option.textContent = `${filter.name} (${count})`;

    if (filter.isDirectCharacterCategory) {
      directGroup.append(option);
    } else {
      otherGroup.append(option);
    }
  }

  const children: HTMLElement[] = [allOption];

  if (directGroup.children.length > 0) {
    children.push(directGroup);
  }

  if (otherGroup.children.length > 0) {
    children.push(otherGroup);
  }

  categorySelect.replaceChildren(...children);
  categorySelect.value = "";
  categorySelect.disabled = categoryFilters.length === 0;
  renderSelectedCategoryFilters();
}

function renderSelectedCategoryFilters(): void {
  selectedCategoryList.replaceChildren();

  if (activeCategoryFilters.length === 0) {
    selectedCategoryList.hidden = true;
    return;
  }

  selectedCategoryList.hidden = false;

  const fragment = document.createDocumentFragment();

  for (const category of activeCategoryFilters) {
    const chip = document.createElement("span");
    const label = document.createElement("span");
    const removeButton = document.createElement("button");

    chip.className = "selected-category-chip";
    label.textContent = category;
    removeButton.className = "category-chip-remove";
    removeButton.type = "button";
    removeButton.textContent = "x";
    removeButton.ariaLabel = `Remove ${category} category filter`;
    removeButton.addEventListener("click", () => {
      removeCategoryFilter(category);
    });

    chip.append(label, removeButton);
    fragment.append(chip);
  }

  selectedCategoryList.replaceChildren(fragment);
}

function renderCounts(): void {
  const rankedTotal = tierKeys.reduce((total, tier) => total + state.tiers[tier].length, 0);
  const unrankedTotal = Math.max(0, characters.length - rankedTotal);
  const visibleTotal = getVisiblePoolCharacters().length;
  const isFiltered = searchInput.value.trim().length > 0 || activeCategoryFilters.length > 0;

  poolCount.textContent = isFiltered
    ? `${visibleTotal} shown / ${unrankedTotal} unranked`
    : `${unrankedTotal} unranked`;
  rankedCount.textContent = `${rankedTotal} / ${characters.length}`;
}

function renderDetails(): void {
  const character = selectedId ? characterMap.get(selectedId) : undefined;

  if (!character) {
    detailsContent.replaceChildren(createEmptyDetails("Select a character"));
    return;
  }

  detailsContent.replaceChildren(...createCharacterDetailsContent(character));
}

function createCharacterDetailsContent(character: Character, headingId?: string): HTMLElement[] {
  const body = document.createElement("div");
  body.className = "details-body";

  const heading = document.createElement("h3");
  heading.textContent = character.name;

  if (headingId) {
    heading.id = headingId;
  }

  const summary = document.createElement("p");
  summary.className = "details-summary";
  summary.textContent = character.summary || "No summary is available from the wiki page.";

  const link = document.createElement("a");
  link.className = "wiki-link";
  link.href = character.pageUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open wiki";

  body.append(heading, summary, link);

  if (character.imageUrl) {
    const image = document.createElement("img");
    image.className = "details-image";
    image.src = character.imageUrl;
    image.alt = `${character.name} image`;
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.replaceWith(createDetailsFallback(character));
    });

    return [image, body];
  }

  return [createDetailsFallback(character), body];
}

function renderLoadError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  const body = document.createElement("div");
  body.className = "details-body";

  const heading = document.createElement("h3");
  heading.textContent = "Load failed";

  const text = document.createElement("p");
  text.className = "details-summary";
  text.textContent = message;

  body.append(heading, text);
  detailsContent.replaceChildren(body);
}

function createCharacterCard(character: Character): HTMLElement {
  const card = cardTemplate.content.firstElementChild?.cloneNode(true);

  if (!(card instanceof HTMLElement)) {
    throw new Error("Character card template is missing.");
  }

  const image = card.querySelector<HTMLImageElement>(".portrait");
  const fallback = card.querySelector<HTMLElement>(".portrait-fallback");
  const name = card.querySelector<HTMLElement>(".character-name");

  card.dataset.id = character.id;
  card.tabIndex = 0;
  card.setAttribute("aria-label", character.name);
  card.classList.toggle("selected", selectedId === character.id);

  if (name) {
    name.textContent = character.name;
  }

  if (fallback) {
    fallback.textContent = getInitials(character.name);
  }

  if (image && fallback) {
    if (character.imageUrl) {
      image.src = character.imageUrl;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      fallback.hidden = true;
      image.addEventListener("error", () => {
        image.hidden = true;
        fallback.hidden = false;
      });
    } else {
      image.hidden = true;
      fallback.hidden = false;
    }
  }

  card.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    if (isMobileExperience() && getCardZone(card) === "pool") {
      return;
    }

    startPointerDrag(event, character.id, card);
  });

  card.addEventListener("click", (event) => {
    if (suppressNextClickId === character.id) {
      event.preventDefault();
      suppressNextClickId = null;
      return;
    }

    if (isMobileExperience()) {
      const zone = getCardZone(card);

      if (zone === "pool") {
        event.preventDefault();
        startPendingPlacement(character.id);
        return;
      }

      if (pendingPlacementId) {
        return;
      }

      event.preventDefault();
      openMobileDetailsDialog(character.id, card);
      return;
    }

    selectCharacter(character.id);
  });

  card.addEventListener("mouseenter", () => {
    selectCharacter(character.id, false);
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectCharacter(character.id);
    }
  });

  return card;
}

function attachDropZone(zone: HTMLElement): void {
  zone.addEventListener("dragover", (event) => {
    if (!draggedId) {
      return;
    }

    event.preventDefault();
    zone.classList.add("drag-over");
  });

  zone.addEventListener("dragleave", (event) => {
    if (!zone.contains(event.relatedTarget as Node | null)) {
      zone.classList.remove("drag-over");
    }
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag-over");

    const id = event.dataTransfer?.getData("text/plain") || draggedId;

    if (!id || !characterMap.has(id)) {
      return;
    }

    const targetCard = getClosestCard(event.target);
    const targetId = targetCard?.dataset.id ?? null;
    const insertAfter = targetCard ? shouldInsertAfterTarget(event, targetCard) : false;
    const zoneKey = zone.dataset.zone as ZoneKey | undefined;

    if (!zoneKey) {
      return;
    }

    moveCharacter(id, zoneKey, targetId, insertAfter);
  });
}

function handleTierRowPlacement(event: MouseEvent, tier: TierKey): void {
  if (!pendingPlacementId || !isMobileExperience()) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const targetCard = getClosestCard(event.target);
  const targetId = targetCard?.dataset.id ?? null;
  const insertAfter = targetCard ? shouldInsertAfterPoint(event.clientX, event.clientY, targetCard) : false;
  const id = pendingPlacementId;
  pendingPlacementId = null;

  moveCharacter(id, tier, targetId, insertAfter);
}

function startPendingPlacement(id: CharacterId): void {
  const character = characterMap.get(id);

  if (!character) {
    return;
  }

  pendingPlacementId = id;
  selectedId = id;
  setCharacterPickerOpen(false);
  renderDetails();
  renderMobileControls();
  setStatus(`${character.name} ready to place.`);
}

function clearPendingPlacement(): void {
  pendingPlacementId = null;
  renderMobileControls();
  setStatus("Placement canceled.");
}

function setCharacterPickerOpen(open: boolean): void {
  isPickerOpen = open && isMobileExperience();
  renderMobileControls();

  if (isPickerOpen) {
    window.setTimeout(() => {
      searchInput.focus();
    }, 0);
  }
}

function syncMobileExperience(): void {
  if (!isMobileExperience()) {
    isPickerOpen = false;
    pendingPlacementId = null;
  }

  renderMobileControls();
}

function renderMobileControls(): void {
  const isMobile = isMobileExperience();
  const placementCharacter = pendingPlacementId ? characterMap.get(pendingPlacementId) : undefined;
  const hasUnrankedCharacters = getUnrankedCharacters().length > 0;

  document.body.classList.toggle("is-mobile-experience", isMobile);
  document.body.classList.toggle("is-picker-open", isMobile && isPickerOpen);
  document.body.classList.toggle("is-placement-active", isMobile && Boolean(placementCharacter));

  openPickerButton.disabled = !hasUnrankedCharacters;
  pickerBackdrop.hidden = !(isMobile && isPickerOpen);
  placementBar.hidden = !(isMobile && placementCharacter);
  placementName.textContent = placementCharacter?.name ?? "";

  if (isMobile && !isPickerOpen) {
    poolPanel.setAttribute("aria-hidden", "true");
    poolPanel.setAttribute("inert", "");
  } else {
    poolPanel.removeAttribute("aria-hidden");
    poolPanel.removeAttribute("inert");
  }
}

function startPointerDrag(event: PointerEvent, id: CharacterId, card: HTMLElement): void {
  pointerDrag = {
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    sourceCard: card,
    ghost: null
  };

  try {
    card.setPointerCapture(event.pointerId);
  } catch {
    // Some embedded browsers do not allow capture here; document-level listeners still handle the drag.
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) {
    return;
  }

  const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);

  if (!pointerDrag.active && distance < 6) {
    return;
  }

  if (!pointerDrag.active) {
    pointerDrag.active = true;
    pointerDrag.ghost = createDragGhost(pointerDrag.sourceCard);
    pointerDrag.sourceCard.classList.add("pointer-drag-source");
    document.body.classList.add("is-pointer-dragging");
  }

  event.preventDefault();
  updateDragGhost(pointerDrag.ghost, event.clientX, event.clientY);
  highlightDropTarget(event.clientX, event.clientY);
}

function handlePointerUp(event: PointerEvent): void {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) {
    return;
  }

  const currentDrag = pointerDrag;
  const dropTarget = currentDrag.active ? getDropTargetAt(event.clientX, event.clientY) : null;

  if (currentDrag.active) {
    event.preventDefault();
    suppressNextClickId = currentDrag.id;
    window.setTimeout(() => {
      if (suppressNextClickId === currentDrag.id) {
        suppressNextClickId = null;
      }
    }, 0);
  }

  cleanupPointerDrag();

  if (dropTarget) {
    moveCharacter(currentDrag.id, dropTarget.zoneKey, dropTarget.targetId, dropTarget.insertAfter);
  }
}

function handlePointerCancel(event: PointerEvent): void {
  if (pointerDrag && event.pointerId === pointerDrag.pointerId) {
    cleanupPointerDrag();
  }
}

function createDragGhost(sourceCard: HTMLElement): HTMLElement {
  const ghost = sourceCard.cloneNode(true);

  if (!(ghost instanceof HTMLElement)) {
    throw new Error("Could not create drag ghost.");
  }

  const sourceRect = sourceCard.getBoundingClientRect();
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("selected", "pointer-drag-source");
  ghost.style.width = `${sourceRect.width}px`;
  document.body.append(ghost);
  return ghost;
}

function updateDragGhost(ghost: HTMLElement | null, clientX: number, clientY: number): void {
  if (!ghost) {
    return;
  }

  ghost.style.transform = `translate(${clientX + 10}px, ${clientY + 10}px)`;
}

function highlightDropTarget(clientX: number, clientY: number): void {
  document.querySelectorAll(".drag-over").forEach((element) => element.classList.remove("drag-over"));
  const target = getDropTargetAt(clientX, clientY);

  if (!target) {
    return;
  }

  document.querySelector<HTMLElement>(`.drop-zone[data-zone="${target.zoneKey}"]`)?.classList.add("drag-over");
}

function getDropTargetAt(clientX: number, clientY: number): DropTarget | null {
  const element = document.elementFromPoint(clientX, clientY);
  const zone = element?.closest<HTMLElement>(".drop-zone");

  if (!zone) {
    return null;
  }

  const zoneKey = zone.dataset.zone as ZoneKey | undefined;

  if (!zoneKey) {
    return null;
  }

  const targetCard = element?.closest<HTMLElement>(".character-card");
  const targetId = targetCard && zone.contains(targetCard) ? targetCard.dataset.id ?? null : null;
  const insertAfter = targetCard ? shouldInsertAfterPoint(clientX, clientY, targetCard) : false;

  return {
    zoneKey,
    targetId,
    insertAfter
  };
}

function cleanupPointerDrag(): void {
  if (!pointerDrag) {
    return;
  }

  pointerDrag.sourceCard.classList.remove("pointer-drag-source");
  pointerDrag.ghost?.remove();
  pointerDrag = null;
  document.body.classList.remove("is-pointer-dragging");
  document.querySelectorAll(".drag-over").forEach((element) => element.classList.remove("drag-over"));
}

function moveCharacter(
  id: CharacterId,
  zoneKey: ZoneKey,
  targetId: CharacterId | null,
  insertAfter: boolean
): void {
  const next = cloneState(state);

  for (const tier of tierKeys) {
    next.tiers[tier] = next.tiers[tier].filter((existingId) => existingId !== id);
  }

  if (zoneKey !== "pool") {
    const tier = zoneKey;
    const targetIndex = targetId ? next.tiers[tier].indexOf(targetId) : -1;
    const insertionIndex = targetIndex >= 0
      ? targetIndex + (insertAfter ? 1 : 0)
      : next.tiers[tier].length;

    next.tiers[tier].splice(insertionIndex, 0, id);
  }

  next.updatedAt = new Date().toISOString();
  state = next;
  selectedId = id;
  pendingPlacementId = pendingPlacementId === id ? null : pendingPlacementId;

  if (viewingSharedTier) {
    viewingSharedTier = false;
    shareNotice.hidden = true;
    clearHash();
  }

  saveLocalState();
  render();
}

function selectCharacter(id: CharacterId, updateCards = true): void {
  selectedId = id;
  renderDetails();

  if (!updateCards) {
    return;
  }

  updateSelectedCharacterCards(id);
}

function updateSelectedCharacterCards(id: CharacterId): void {
  document.querySelectorAll(".character-card.selected").forEach((element) => {
    element.classList.remove("selected");
  });

  document.querySelectorAll<HTMLElement>(`.character-card[data-id="${CSS.escape(id)}"]`).forEach((element) => {
    element.classList.add("selected");
  });
}

async function shareTier(): Promise<void> {
  const payload: SharedTierPayload = {
    v: 1,
    t: state.tiers
  };
  const encoded = encodeSharePayload(payload);
  const url = new URL(window.location.href);
  url.hash = `tier=${encoded}`;
  const shareUrl = url.toString();

  showShareLink(shareUrl);
  setStatus("Share link ready.");

  const shareData: ShareData = {
    title: "Dungeon Crawler Carl tier list",
    text: "My Dungeon Crawler Carl character tier list",
    url: shareUrl
  };

  try {
    if (shouldUseNativeShare(shareData)) {
      await navigator.share(shareData);
      setStatus("Share sheet opened.");
      return;
    }
  } catch {
    // Some browsers expose Web Share but reject it for policy or permission reasons.
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    setStatus("Share link copied.");
  } catch {
    setStatus("Share link ready.");
  }
}

function shouldUseNativeShare(shareData: ShareData): boolean {
  if (!navigator.share || (navigator.canShare && !navigator.canShare(shareData))) {
    return false;
  }

  const isTouchFirst = window.matchMedia("(pointer: coarse)").matches &&
    window.matchMedia("(hover: none)").matches;
  const isSmallTouchScreen = navigator.maxTouchPoints > 0 &&
    window.matchMedia("(max-width: 820px)").matches;

  return isTouchFirst || isSmallTouchScreen;
}

function showShareLink(shareUrl: string): void {
  shareLinkInput.value = shareUrl;
  shareLinkPanel.hidden = false;
  shareLinkInput.select();
}

async function copyShareLinkFromInput(): Promise<void> {
  const shareUrl = shareLinkInput.value;

  if (!shareUrl) {
    return;
  }

  shareLinkInput.select();

  try {
    await navigator.clipboard.writeText(shareUrl);
    setStatus("Share link copied.");
  } catch {
    setStatus("Share link selected.");
  }
}

async function downloadTierImage(): Promise<void> {
  const canvas = document.createElement("canvas");
  const width = 1600;
  const padding = 34;
  const labelWidth = 110;
  const cardWidth = 214;
  const cardHeight = 54;
  const gap = 10;
  const rowGap = 14;
  const headerHeight = 92;
  const footerHeight = 44;
  const cardsPerRow = Math.max(1, Math.floor((width - padding * 2 - labelWidth - gap * 2) / (cardWidth + gap)));
  const rowHeights = tierKeys.map((tier) => {
    const count = state.tiers[tier].length;
    const lines = Math.max(1, Math.ceil(count / cardsPerRow));
    return Math.max(92, gap * 2 + lines * cardHeight + Math.max(0, lines - 1) * gap);
  });
  const height = headerHeight + footerHeight + rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) + rowGap * (tierKeys.length - 1) + padding * 2;

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    setStatus("Could not create image.");
    return;
  }

  drawTierImage(context, width, height, padding, labelWidth, cardWidth, cardHeight, gap, rowGap, headerHeight, rowHeights);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

  if (!blob) {
    setStatus("Could not create image.");
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "dungeon-crawler-carl-tier-list.png";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  setStatus("PNG downloaded.");
}

function drawTierImage(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  padding: number,
  labelWidth: number,
  cardWidth: number,
  cardHeight: number,
  gap: number,
  rowGap: number,
  headerHeight: number,
  rowHeights: number[]
): void {
  context.fillStyle = "#171614";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#f4efe5";
  context.font = "800 42px Segoe UI, Arial, sans-serif";
  context.fillText("Dungeon Crawler Carl Tier List", padding, padding + 42);

  context.fillStyle = "#bfb4a4";
  context.font = "24px Segoe UI, Arial, sans-serif";
  context.fillText(`${rankedCharacterCount()} ranked of ${characters.length} live wiki characters`, padding, padding + 76);

  let y = padding + headerHeight;

  for (let rowIndex = 0; rowIndex < tierKeys.length; rowIndex += 1) {
    const tier = tierKeys[rowIndex];
    const rowHeight = rowHeights[rowIndex];
    const rowX = padding;
    const rowWidth = width - padding * 2;

    drawRoundedRect(context, rowX, y, rowWidth, rowHeight, 8, "#24211d", "#463f36");
    drawRoundedRect(context, rowX, y, labelWidth, rowHeight, 8, tierColors[tier], tierColors[tier]);

    context.fillStyle = "#15110c";
    context.font = "900 52px Segoe UI, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(tier, rowX + labelWidth / 2, y + rowHeight / 2);
    context.textAlign = "start";
    context.textBaseline = "alphabetic";

    const ids = state.tiers[tier];

    ids.forEach((id, index) => {
      const character = characterMap.get(id);

      if (!character) {
        return;
      }

      const column = index % Math.max(1, Math.floor((rowWidth - labelWidth - gap * 2) / (cardWidth + gap)));
      const line = Math.floor(index / Math.max(1, Math.floor((rowWidth - labelWidth - gap * 2) / (cardWidth + gap))));
      const cardX = rowX + labelWidth + gap + column * (cardWidth + gap);
      const cardY = y + gap + line * (cardHeight + gap);

      drawRoundedRect(context, cardX, cardY, cardWidth, cardHeight, 7, "#1c1a17", "#6d5d4b");
      context.fillStyle = "#f4efe5";
      context.font = "700 20px Segoe UI, Arial, sans-serif";
      wrapCanvasText(context, character.name, cardX + 12, cardY + 24, cardWidth - 24, 22, 2);
    });

    y += rowHeight + rowGap;
  }

  context.fillStyle = "#8d8a80";
  context.font = "20px Segoe UI, Arial, sans-serif";
  context.fillText("Built from live Dungeon Crawler Carl Fandom wiki data", padding, height - padding);
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
  strokeStyle: string
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
  context.strokeStyle = strokeStyle;
  context.stroke();
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): void {
  const words = text.split(/\s+/);
  let line = "";
  let drawnLines = 0;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;

    if (context.measureText(testLine).width > maxWidth && line) {
      drawnLines += 1;
      context.fillText(drawnLines === maxLines ? `${line}...` : line, x, y);

      if (drawnLines >= maxLines) {
        return;
      }

      line = word;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line && drawnLines < maxLines) {
    context.fillText(line, x, y);
  }
}

function createDetailsFallback(character: Character): HTMLElement {
  const fallback = document.createElement("div");
  fallback.className = "details-image details-fallback";
  fallback.textContent = getInitials(character.name);
  return fallback;
}

function createEmptyDetails(message: string): HTMLElement {
  const empty = document.createElement("p");
  empty.className = "empty-details";
  empty.textContent = message;
  return empty;
}

function createEmptyState(): TierState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tiers: {
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
      F: []
    }
  };
}

function reconcileState(input: TierState | SharedTierPayload): TierState {
  const next = createEmptyState();
  const sourceTiers = "tiers" in input ? input.tiers : input.t;
  const seen = new Set<CharacterId>();

  for (const tier of tierKeys) {
    const ids = sourceTiers[tier] ?? [];

    for (const rawId of ids) {
      const id = String(rawId);

      if (!seen.has(id) && characterMap.has(id)) {
        next.tiers[tier].push(id);
        seen.add(id);
      }
    }
  }

  if ("updatedAt" in input && typeof input.updatedAt === "string") {
    next.updatedAt = input.updatedAt;
  }

  return next;
}

function cloneState(input: TierState): TierState {
  return {
    version: 1,
    updatedAt: input.updatedAt,
    tiers: {
      S: [...input.tiers.S],
      A: [...input.tiers.A],
      B: [...input.tiers.B],
      C: [...input.tiers.C],
      D: [...input.tiers.D],
      F: [...input.tiers.F]
    }
  };
}

function loadLocalState(): TierState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<TierState>;

    if (parsed.version !== 1 || !parsed.tiers) {
      return null;
    }

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      tiers: {
        S: arrayOfStrings(parsed.tiers.S),
        A: arrayOfStrings(parsed.tiers.A),
        B: arrayOfStrings(parsed.tiers.B),
        C: arrayOfStrings(parsed.tiers.C),
        D: arrayOfStrings(parsed.tiers.D),
        F: arrayOfStrings(parsed.tiers.F)
      }
    };
  } catch (error) {
    console.warn("Could not load saved tier state", error);
    return null;
  }
}

function saveLocalState(): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readSharedStateFromLocation(): SharedTierPayload | null {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const tierParam = new URLSearchParams(hash).get("tier");

  if (!tierParam) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeSharePayload(tierParam)) as Partial<SharedTierPayload>;

    if (parsed.v !== 1 || !parsed.t) {
      return null;
    }

    return {
      v: 1,
      t: {
        S: arrayOfStrings(parsed.t.S),
        A: arrayOfStrings(parsed.t.A),
        B: arrayOfStrings(parsed.t.B),
        C: arrayOfStrings(parsed.t.C),
        D: arrayOfStrings(parsed.t.D),
        F: arrayOfStrings(parsed.t.F)
      }
    };
  } catch (error) {
    console.warn("Could not read shared tier", error);
    return null;
  }
}

function encodeSharePayload(payload: SharedTierPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeSharePayload(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function clearHash(): void {
  history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
}

function getUnrankedCharacters(): Character[] {
  const rankedIds = getRankedIdSet();
  return getDistinctCharacters(characters).filter((character) => !rankedIds.has(character.id));
}

function getDistinctCharacters(items: Character[]): Character[] {
  const seen = new Set<CharacterId>();
  const distinct: Character[] = [];

  for (const character of items) {
    if (seen.has(character.id)) {
      continue;
    }

    seen.add(character.id);
    distinct.push(character);
  }

  return distinct;
}

function getVisiblePoolCharacters(): Character[] {
  const searchTerm = searchInput.value.trim().toLocaleLowerCase();
  const selectedCategorySet = new Set(activeCategoryFilters);

  return getUnrankedCharacters().filter((character) => {
    if (
      selectedCategorySet.size > 0 &&
      !character.categories.some((category) => selectedCategorySet.has(category))
    ) {
      return false;
    }

    return searchTerm.length === 0 || character.name.toLocaleLowerCase().includes(searchTerm);
  });
}

function countCategories(items: Character[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const character of items) {
    for (const category of character.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }

  return counts;
}

function getRankedIdSet(): Set<CharacterId> {
  const ranked = new Set<CharacterId>();

  for (const tier of tierKeys) {
    for (const id of state.tiers[tier]) {
      ranked.add(id);
    }
  }

  return ranked;
}

function rankedCharacterCount(): number {
  return tierKeys.reduce((total, tier) => total + state.tiers[tier].length, 0);
}

function firstAvailableCharacterId(): CharacterId | null {
  for (const tier of tierKeys) {
    const id = state.tiers[tier][0];

    if (id && characterMap.has(id)) {
      return id;
    }
  }

  return characters[0]?.id ?? null;
}

function shouldInsertAfterTarget(event: DragEvent, target: HTMLElement): boolean {
  return shouldInsertAfterPoint(event.clientX, event.clientY, target);
}

function shouldInsertAfterPoint(clientX: number, clientY: number, target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect();
  const lowerHalf = clientY > rect.top + rect.height / 2;
  const rightHalf = clientX > rect.left + rect.width / 2;
  return lowerHalf || rightHalf;
}

function getClosestCard(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(".character-card") : null;
}

function getCardZone(card: HTMLElement): ZoneKey | null {
  const zone = card.closest<HTMLElement>(".drop-zone");
  return (zone?.dataset.zone as ZoneKey | undefined) ?? null;
}

function isMobileExperience(): boolean {
  return mobileExperienceQuery.matches;
}

function shouldIgnoreTitle(title: string): boolean {
  return ignoredTitlePrefixes.some((prefix) => title.startsWith(prefix));
}

function compareCharactersByName(first: Character, second: Character): number {
  return first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
}

function compareCategoryNames(first: string, second: string): number {
  return first.localeCompare(second, undefined, { sensitivity: "base" });
}

function getCategoryFilters(items: Character[], directCharacterCategories: Set<string>): CategoryFilter[] {
  return Array.from(countCategories(items).entries())
    .map(([name, count]) => ({
      name,
      count,
      isDirectCharacterCategory: directCharacterCategories.has(name)
    }))
    .sort((first, second) => {
      if (first.isDirectCharacterCategory !== second.isDirectCharacterCategory) {
        return first.isDirectCharacterCategory ? -1 : 1;
      }

      return second.count - first.count || compareCategoryNames(first.name, second.name);
    });
}

function getPageCategories(page: DetailPage): string[] {
  const categories = (page.categories ?? [])
    .map((category) => stripCategoryPrefix(category.title?.trim() ?? ""))
    .filter(isUserFacingCategory);

  return Array.from(new Set(categories)).sort(compareCategoryNames);
}

function stripCategoryPrefix(title: string): string {
  return title.startsWith("Category:") ? title.slice("Category:".length) : "";
}

function isUserFacingCategory(category: string): boolean {
  return category.length > 0 && !ignoredFilterCategories.has(category);
}

function getRevisionContent(page: DetailPage): string | null {
  const revision = page.revisions?.[0];

  if (!revision) {
    return null;
  }

  return revision.slots?.main?.content ??
    revision.slots?.main?.["*"] ??
    revision.content ??
    revision["*"] ??
    null;
}

function extractFirstSentenceFromWikitext(wikitext: string): string {
  if (!wikitext.trim()) {
    return "";
  }

  let text = wikitext
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<gallery\b[^>]*>[\s\S]*?<\/gallery>/giu, "");

  text = removeTableBlocks(text);
  text = removeBalancedTemplates(text);
  text = text.replace(/<ref\b[^>/]*(?:\/>|>[\s\S]*?<\/ref>)/giu, "");

  for (const rawLine of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const cleaned = cleanWikitextLine(rawLine);

    if (isProseCandidate(cleaned)) {
      return getFirstSentence(cleaned);
    }
  }

  return "";
}

function removeTableBlocks(text: string): string {
  const lines: string[] = [];
  let inTable = false;

  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const trimmed = line.trimStart();

    if (trimmed.startsWith("{|")) {
      inTable = true;
      continue;
    }

    if (inTable) {
      if (trimmed.startsWith("|}")) {
        inTable = false;
      }

      continue;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

function removeBalancedTemplates(text: string): string {
  let output = "";
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{" && text[index + 1] === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (depth > 0 && text[index] === "}" && text[index + 1] === "}") {
      depth -= 1;
      index += 1;
      continue;
    }

    if (depth === 0) {
      output += text[index];
    }
  }

  return output;
}

function cleanWikitextLine(line: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      line
        .trim()
        .replace(/<ref\b[^>/]*(?:\/>|>[\s\S]*?<\/ref>)/giu, "")
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_match, target: string, label: string | undefined) => {
          return shouldIgnoreTitle(target) || target.startsWith("Image:") ? "" : label ?? target;
        })
        .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/giu, "$1")
        .replace(/\[(?:https?:)?\/\/[^\]]+\]/giu, "")
        .replace(/<[^>]+>/gu, "")
        .replace(/'''/g, "")
        .replace(/''/g, "")
    )
  );
}

function isProseCandidate(line: string): boolean {
  if (!line || !/[A-Za-z]/u.test(line)) {
    return false;
  }

  return !["=", "*", "#", ":", "|", "!", "{", "}", "__"].some((prefix) => line.startsWith(prefix));
}

function getFirstSentence(text: string): string {
  const normalized = normalizeWhitespace(text);

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (![".", "!", "?"].includes(character)) {
      continue;
    }

    const isBoundary = index === normalized.length - 1 || /\s/u.test(normalized[index + 1]);

    if (isBoundary && !isLikelyAbbreviation(normalized, index)) {
      return normalized.slice(0, index + 1);
    }
  }

  return normalized;
}

function isLikelyAbbreviation(text: string, punctuationIndex: number): boolean {
  const tokenStart = text.lastIndexOf(" ", punctuationIndex);
  const token = text.slice(tokenStart + 1, punctuationIndex + 1);
  const common = new Set(["Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.", "St.", "No.", "U.S.", "U.K.", "e.g.", "i.e."]);

  if (common.has(token)) {
    return true;
  }

  if ((token.match(/\./g) ?? []).length > 1) {
    return true;
  }

  const letters = token.replace(/[^A-Za-z]/gu, "");
  return letters.length > 0 && letters.length <= 3 && letters === letters.toUpperCase();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function getInitials(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/gu) ?? [];
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

function wikiUrlForTitle(title: string): string {
  return `https://dungeon-crawler-carl.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getRetryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");

  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);

    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }

  return getBackoffDelay(attempt);
}

function getBackoffDelay(attempt: number): number {
  return 2 ** (attempt - 1) * 750;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element #${id}`);
  }

  return element as T;
}
