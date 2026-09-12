import {
  discoverCastingClasses,
  saveMishapMappings,
  storedMishapConfig
} from "./spell-mishaps.mjs";
import { L, MODULE_ID } from "./lib/dom.mjs";

const MENU_KEY = "spellMishapConfiguration";
const CUSTOM_CLASS_KEY = "__custom__";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function readMappings(root) {
  return Array.from(root?.querySelectorAll?.("[data-mishap-mapping]") ?? []).map(row => {
    const select = row.querySelector('[name="classKey"]');
    const custom = row.querySelector('[name="customClassKey"]');
    const customClass = select?.value === CUSTOM_CLASS_KEY;
    const classKey = customClass ? custom?.value ?? "" : select?.value ?? "";
    return {
      classKey,
      className: customClass
        ? custom?.value ?? ""
        : select?.selectedOptions?.[0]?.textContent ?? classKey,
      tables: {
        tier12: row.querySelector('[name="tier12"]')?.value ?? "",
        tier34: row.querySelector('[name="tier34"]')?.value ?? "",
        tier5: row.querySelector('[name="tier5"]')?.value ?? ""
      }
    };
  });
}

async function addMappingAction() {
  this.draftMappings = readMappings(this.element);
  const options = await this.classOptions();
  const used = new Set(this.draftMappings.map(mapping => mapping.classKey));
  const available = options.find(option => !used.has(option.key));
  this.draftMappings.push({
    classKey: available?.key ?? "",
    className: available?.label ?? "",
    tables: { tier12: "", tier34: "", tier5: "" }
  });
  return this.render();
}

async function removeMappingAction(_event, target) {
  const index = Number(target.closest?.("[data-mishap-mapping]")?.dataset.index);
  this.draftMappings = readMappings(this.element);
  if (Number.isInteger(index) && index >= 0) this.draftMappings.splice(index, 1);
  return this.render();
}

async function saveMappingsAction() {
  if (!game.user.isGM) return;
  const button = this.element?.querySelector?.('[data-action="saveMappings"]');
  if (button) button.disabled = true;
  try {
    const saved = await saveMishapMappings(readMappings(this.element));
    this.draftMappings = saved?.mappings ?? [];
    ui.notifications.info(L("GTNPCMULTIATTACK.Mishaps.Saved"));
    await this.render();
  }
  catch (error) {
    ui.notifications.error(error.message);
    if (button) button.disabled = false;
  }
}

export class SpellMishapConfiguration extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-spell-mishaps`,
    tag: "form",
    classes: ["gt-npc-ma-spell-mishap-configuration"],
    position: { width: 900, height: 540 },
    window: {
      icon: "fa-solid fa-hat-wizard",
      resizable: true,
      contentClasses: ["standard-form"]
    },
    form: {
      closeOnSubmit: false,
      handler: saveMappingsAction
    },
    actions: {
      addMapping: addMappingAction,
      removeMapping: removeMappingAction,
      saveMappings: saveMappingsAction
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/spell-mishap-configuration.hbs`,
      scrollable: [".gt-npc-ma-mishap-mappings"]
    }
  };

  constructor(options = {}) {
    super(options);
    this.draftMappings = null;
    this._classOptions = null;
  }

  get title() {
    return L("GTNPCMULTIATTACK.Mishaps.ConfigurationName");
  }

  _canRender(options) {
    if (!game.user?.isGM) return false;
    return super._canRender(options);
  }

  async classOptions() {
    this._classOptions ??= await discoverCastingClasses();
    return this._classOptions;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const classOptions = await this.classOptions();
    const mappings = this.draftMappings ?? storedMishapConfig().mappings;
    return {
      ...context,
      mappings: mappings.map((mapping, index) => {
        const custom = !classOptions.some(option => option.key === mapping.classKey);
        return {
          ...mapping,
          index,
          custom,
          classOptions: classOptions.map(option => ({
            ...option,
            selected: !custom && option.key === mapping.classKey
          }))
        };
      })
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const row of this.element.querySelectorAll("[data-mishap-mapping]")) {
      const select = row.querySelector('[name="classKey"]');
      const custom = row.querySelector('[name="customClassKey"]');
      const updateVisibility = () => { custom.hidden = select.value !== CUSTOM_CLASS_KEY; };
      select.addEventListener("change", updateVisibility);
      updateVisibility();
    }
  }
}

export function registerSpellMishapConfiguration() {
  game.settings.registerMenu(MODULE_ID, MENU_KEY, {
    name: "GTNPCMULTIATTACK.Mishaps.ConfigurationName",
    label: "GTNPCMULTIATTACK.Mishaps.OpenConfiguration",
    hint: "GTNPCMULTIATTACK.Mishaps.ConfigurationDescription",
    icon: "fa-solid fa-hat-wizard",
    type: SpellMishapConfiguration,
    restricted: true
  });
}
