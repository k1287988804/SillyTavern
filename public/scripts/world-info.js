import { saveSettings, callPopup, substituteParams, getTokenCount, getRequestHeaders, chat_metadata, this_chid, characters, saveCharacterDebounced, menu_type } from "../script.js";
import { download, debounce, initScrollHeight, resetScrollHeight, parseJsonFile, extractDataFromPng, getFileBuffer, delay, getCharaFilename } from "./utils.js";
import { getContext } from "./extensions.js";
import { NOTE_MODULE_NAME, metadata_keys, shouldWIAddPrompt } from "./extensions/floating-prompt/index.js";
import { registerSlashCommand } from "./slash-commands.js";
import { deviceInfo } from "./RossAscends-mods.js";

export {
    world_info,
    world_info_budget,
    world_info_depth,
    world_info_recursive,
    world_info_case_sensitive,
    world_info_match_whole_words,
    world_info_character_strategy,
    world_names,
    checkWorldInfo,
    deleteWorldInfo,
    setWorldInfoSettings,
    getWorldInfoPrompt,
}

const world_info_insertion_strategy = {
    evenly: 0,
    character_first: 1,
    global_first: 2,
};

let world_info = {};
let selected_world_info = [];
let world_names;
let world_info_depth = 2;
let world_info_budget = 25;
let world_info_recursive = false;
let world_info_case_sensitive = false;
let world_info_match_whole_words = false;
let world_info_character_strategy = world_info_insertion_strategy.character_first;
const saveWorldDebounced = debounce(async (name, data) => await _save(name, data), 1000);
const saveSettingsDebounced = debounce(() => {
    Object.assign(world_info, { globalSelect: selected_world_info })
    saveSettings()
}, 1000);
const sortFn = (a, b) => b.order - a.order;

const world_info_position = {
    before: 0,
    after: 1,
    ANTop: 2,
    ANBottom: 3,

};

const worldInfoCache = {};

async function getWorldInfoPrompt(chat2, maxContext) {
    let worldInfoString = "", worldInfoBefore = "", worldInfoAfter = "";

    const activatedWorldInfo = await checkWorldInfo(chat2, maxContext);
    worldInfoBefore = activatedWorldInfo.worldInfoBefore;
    worldInfoAfter = activatedWorldInfo.worldInfoAfter;
    worldInfoString = worldInfoBefore + worldInfoAfter;

    return { worldInfoString, worldInfoBefore, worldInfoAfter };
}

function setWorldInfoSettings(settings, data) {
    if (settings.world_info_depth !== undefined)
        world_info_depth = Number(settings.world_info_depth);
    if (settings.world_info_budget !== undefined)
        world_info_budget = Number(settings.world_info_budget);
    if (settings.world_info_recursive !== undefined)
        world_info_recursive = Boolean(settings.world_info_recursive);
    if (settings.world_info_case_sensitive !== undefined)
        world_info_case_sensitive = Boolean(settings.world_info_case_sensitive);
    if (settings.world_info_match_whole_words !== undefined)
        world_info_match_whole_words = Boolean(settings.world_info_match_whole_words);
    if (settings.world_info_character_strategy !== undefined)
        world_info_character_strategy = Number(settings.world_info_character_strategy);

    // Migrate old settings
    if (world_info_budget > 100) {
        world_info_budget = 25;
    }

    // Reset selected world from old string and delete old keys
    // TODO: Remove next release
    const existingWorldInfo = settings.world_info;
    if (typeof existingWorldInfo === "string") {
        delete settings.world_info;
        selected_world_info = [existingWorldInfo];
    } else if (Array.isArray(existingWorldInfo)) {
        delete settings.world_info;
        selected_world_info = existingWorldInfo;
    }

    world_info = settings.world_info ?? {}

    $("#world_info_depth_counter").text(world_info_depth);
    $("#world_info_depth").val(world_info_depth);

    $("#world_info_budget_counter").text(world_info_budget);
    $("#world_info_budget").val(world_info_budget);

    $("#world_info_recursive").prop('checked', world_info_recursive);
    $("#world_info_case_sensitive").prop('checked', world_info_case_sensitive);
    $("#world_info_match_whole_words").prop('checked', world_info_match_whole_words);

    $(`#world_info_character_strategy option[value='${world_info_character_strategy}']`).prop('selected', true);
    $("#world_info_character_strategy").val(world_info_character_strategy);

    world_names = data.world_names?.length ? data.world_names : [];

    // Add to existing selected WI if it exists
    selected_world_info = selected_world_info.concat(settings.world_info?.globalSelect?.filter((e) => world_names.includes(e)) ?? []);

    if (world_names.length > 0) {
        $("#world_info").empty();
    }

    world_names.forEach((item, i) => {
        $("#world_info").append(`<option value='${i}'${selected_world_info.includes(item) ? ' selected' : ''}>${item}</option>`);
        $("#world_editor_select").append(`<option value='${i}'>${item}</option>`);
    });

    $("#world_editor_select").trigger("change");

    // Update settings
    saveSettingsDebounced();
}

// World Info Editor
async function showWorldEditor(name) {
    if (!name) {
        hideWorldEditor();
        return;
    }

    const wiData = await loadWorldInfoData(name);
    displayWorldEntries(name, wiData);
}

async function loadWorldInfoData(name) {
    if (!name) {
        return;
    }

    if (worldInfoCache[name]) {
        return worldInfoCache[name];
    }

    const response = await fetch("/getworldinfo", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: name }),
        cache: 'no-cache',
    });

    if (response.ok) {
        const data = await response.json();
        worldInfoCache[name] = data;
        return data;
    }

    return null;
}

async function updateWorldInfoList() {
    var result = await fetch("/getsettings", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
    });

    if (result.ok) {
        var data = await result.json();
        world_names = data.world_names?.length ? data.world_names : [];
        $("#world_info").find('option[value!=""]').remove();
        $("#world_editor_select").find('option[value!=""]').remove();

        world_names.forEach((item, i) => {
            $("#world_info").append(`<option value='${i}'${selected_world_info.includes(item) ? ' selected' : ''}>${item}</option>`);
            $("#world_editor_select").append(`<option value='${i}'>${item}</option>`);
        });
    }
}

function hideWorldEditor() {
    displayWorldEntries(null, null);
}

function getWIElement(name) {
    const wiElement = $("#world_info").children().filter(function () {
        return $(this).text().toLowerCase() === name.toLowerCase()
    });

    return wiElement;
}

function nullWorldInfo() {
    toastr.info("Create or import a new World Info file first.", "World Info is not set", { timeOut: 10000, preventDuplicates: true });
}

function displayWorldEntries(name, data) {
    $("#world_popup_entries_list").empty().show();

    if (!data || !("entries" in data)) {
        $("#world_popup_new").off('click').on('click', nullWorldInfo);
        $("#world_popup_name_button").off('click').on('click', nullWorldInfo);
        $("#world_popup_export").off('click').on('click', nullWorldInfo);
        $("#world_popup_delete").off('click').on('click', nullWorldInfo);
        $("#world_popup_entries_list").hide();
        return;
    }

    // Convert the data.entries object into an array
    const entriesArray = Object.keys(data.entries).map(uid => {
        const entry = data.entries[uid];
        entry.displayIndex = entry.displayIndex ?? entry.uid;
        return entry;
    });

    // Sort the entries array by displayIndex and uid
    entriesArray.sort((a, b) => a.displayIndex - b.displayIndex || a.uid - b.uid);

    // Loop through the sorted array and call appendWorldEntry
    for (const entry of entriesArray) {
        appendWorldEntry(name, data, entry);
    }

    $("#world_popup_new").off('click').on('click', () => {
        createWorldInfoEntry(name, data);
    });

    $("#world_popup_name_button").off('click').on('click', async () => {
        await renameWorldInfo(name, data);
    });

    $("#world_popup_export").off('click').on('click', () => {
        if (name && data) {
            const jsonValue = JSON.stringify(data);
            const fileName = `${name}.json`;
            download(jsonValue, fileName, "application/json");
        }
    });

    $("#world_popup_delete").off('click').on('click', async () => {
        const confirmation = await callPopup(`<h3>Delete the World/Lorebook: "${name}"?</h3>This action is irreversible!`, "confirm");

        if (!confirmation) {
            return;
        }

        if (world_info.charLore) {
            world_info.charLore.forEach((charLore, index) => {
                if (charLore.extraBooks?.includes(name)) {
                    const tempCharLore = charLore.extraBooks.filter((e) => e !== name);
                    if (tempCharLore.length === 0) {
                        world_info.charLore.splice(index, 1);
                    } else {
                        charLore.extraBooks = tempCharLore;
                    }
                }
            });

            saveSettingsDebounced();
        }

        // Selected world_info automatically refreshes
        await deleteWorldInfo(name);
    });

    // Check if a sortable instance exists
    if ($('#world_popup_entries_list').sortable('instance') !== undefined) {
        // Destroy the instance
        $('#world_popup_entries_list').sortable('destroy');
    }

    $("#world_popup_entries_list").sortable({
        handle: ".drag-handle",
        stop: async function (event, ui) {
            $('#world_popup_entries_list .world_entry').each(function (index) {
                const uid = $(this).data('uid');

                // Update the display index in the data array
                const item = data.entries[uid];

                if (!item) {
                    console.debug(`Could not find entry with uid ${uid}`);
                    return;
                }

                item.displayIndex = index;
                setOriginalDataValue(data, uid, 'extensions.display_index', index);
            });

            console.table(Object.keys(data.entries).map(uid => data.entries[uid]).map(x => ({ uid: x.uid, key: x.key.join(','), displayIndex: x.displayIndex })));

            await saveWorldInfo(name, data, true);
        }
    });
    //$("#world_popup_entries_list").disableSelection();
}

function setOriginalDataValue(data, uid, key, value) {
    if (data.originalData && Array.isArray(data.originalData.entries)) {
        let originalEntry = data.originalData.entries.find(x => x.uid === uid);

        if (!originalEntry) {
            return;
        }

        const keyParts = key.split('.');
        let currentObject = originalEntry;

        for (let i = 0; i < keyParts.length - 1; i++) {
            const part = keyParts[i];

            if (!currentObject.hasOwnProperty(part)) {
                currentObject[part] = {};
            }

            currentObject = currentObject[part];
        }

        currentObject[keyParts[keyParts.length - 1]] = value;
    }
}

function deleteOriginalDataValue(data, uid) {
    if (data.originalData && Array.isArray(data.originalData.entries)) {
        const originalIndex = data.originalData.entries.findIndex(x => x.uid === uid);

        if (originalIndex >= 0) {
            data.originalData.entries.splice(originalIndex, 1);
        }
    }
}

function appendWorldEntry(name, data, entry) {
    const template = $("#entry_edit_template .world_entry").clone();
    template.data("uid", entry.uid);

    // key
    const keyInput = template.find('textarea[name="key"]');
    keyInput.data("uid", entry.uid);
    keyInput.on("click", function (event) {
        // Prevent closing the drawer on clicking the input
        event.stopPropagation();
    });

    keyInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).val();
        resetScrollHeight(this);
        data.entries[uid].key = value
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x);

        setOriginalDataValue(data, uid, "keys", data.entries[uid].key);
        saveWorldInfo(name, data);
    });
    keyInput.val(entry.key.join(",")).trigger("input");
    initScrollHeight(keyInput);

    // keysecondary
    const keySecondaryInput = template.find('textarea[name="keysecondary"]');
    keySecondaryInput.data("uid", entry.uid);
    keySecondaryInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).val();
        resetScrollHeight(this);
        data.entries[uid].keysecondary = value
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x);

        setOriginalDataValue(data, uid, "secondary_keys", data.entries[uid].keysecondary);
        saveWorldInfo(name, data);
    });

    keySecondaryInput.val(entry.keysecondary.join(",")).trigger("input");
    initScrollHeight(keySecondaryInput);

    // comment
    const commentInput = template.find('textarea[name="comment"]');
    const commentToggle = template.find('input[name="addMemo"]');
    commentInput.data("uid", entry.uid);
    commentInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).val();
        data.entries[uid].comment = value;

        setOriginalDataValue(data, uid, "comment", data.entries[uid].comment);
        saveWorldInfo(name, data);
    });
    commentToggle.data("uid", entry.uid);
    commentToggle.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).prop("checked");
        //console.log(value)
        const commentContainer = $(this)
            .closest(".world_entry")
            .find(".commentContainer");
        data.entries[uid].addMemo = value;
        saveWorldInfo(name, data);
        value ? commentContainer.show() : commentContainer.hide();
    });

    commentInput.val(entry.comment).trigger("input");
    commentToggle.prop("checked", true /* entry.addMemo */).trigger("input");
    commentToggle.parent().hide()

    // content
    const countTokensDebounced = debounce(function (that, value) {
        const numberOfTokens = getTokenCount(value);
        $(that)
            .closest(".world_entry")
            .find(".world_entry_form_token_counter")
            .text(numberOfTokens);
    }, 1000);

    const contentInput = template.find('textarea[name="content"]');
    contentInput.data("uid", entry.uid);
    contentInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).val();
        data.entries[uid].content = value;

        setOriginalDataValue(data, uid, "content", data.entries[uid].content);
        saveWorldInfo(name, data);

        // count tokens
        countTokensDebounced(this, value);
    });
    contentInput.val(entry.content).trigger("input");
    //initScrollHeight(contentInput);

    // selective
    const selectiveInput = template.find('input[name="selective"]');
    selectiveInput.data("uid", entry.uid);
    selectiveInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).prop("checked");
        data.entries[uid].selective = value;

        setOriginalDataValue(data, uid, "selective", data.entries[uid].selective);
        saveWorldInfo(name, data);

        const keysecondary = $(this)
            .closest(".world_entry")
            .find(".keysecondary");

        const keysecondarytextpole = $(this)
            .closest(".world_entry")
            .find(".keysecondarytextpole");

        const keyprimarytextpole = $(this)
            .closest(".world_entry")
            .find(".keyprimarytextpole");

        const keyprimaryHeight = keyprimarytextpole.outerHeight();
        keysecondarytextpole.css('height', keyprimaryHeight + 'px');

        value ? keysecondary.show() : keysecondary.hide();

    });
    selectiveInput.prop("checked", true /* entry.selective */).trigger("input");
    selectiveInput.parent().hide();


    // constant
    const constantInput = template.find('input[name="constant"]');
    constantInput.data("uid", entry.uid);
    constantInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).prop("checked");
        data.entries[uid].constant = value;
        setOriginalDataValue(data, uid, "constant", data.entries[uid].constant);
        saveWorldInfo(name, data);
    });
    constantInput.prop("checked", entry.constant).trigger("input");

    // order
    const orderInput = template.find('input[name="order"]');
    orderInput.data("uid", entry.uid);
    orderInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = Number($(this).val());

        data.entries[uid].order = !isNaN(value) ? value : 0;
        setOriginalDataValue(data, uid, "insertion_order", data.entries[uid].order);
        saveWorldInfo(name, data);
    });
    orderInput.val(entry.order).trigger("input");

    // probability
    if (entry.probability === undefined) {
        entry.probability = null;
    }

    const probabilityInput = template.find('input[name="probability"]');
    probabilityInput.data("uid", entry.uid);
    probabilityInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = parseInt($(this).val());

        data.entries[uid].probability = !isNaN(value) ? value : null;

        // Clamp probability to 0-100
        if (data.entries[uid].probability !== null) {
            data.entries[uid].probability = Math.min(100, Math.max(0, data.entries[uid].probability));

            if (data.entries[uid].probability !== value) {
                $(this).val(data.entries[uid].probability);
            }
        }

        setOriginalDataValue(data, uid, "extensions.probability", data.entries[uid].probability);
        saveWorldInfo(name, data);
    });
    probabilityInput.val(entry.probability).trigger("input");

    // probability toggle
    if (entry.useProbability === undefined) {
        entry.useProbability = false;
    }

    const probabilityToggle = template.find('input[name="useProbability"]');
    probabilityToggle.data("uid", entry.uid);
    probabilityToggle.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).prop("checked");
        data.entries[uid].useProbability = value;
        const probabilityContainer = $(this)
            .closest(".world_entry")
            .find(".probabilityContainer");
        saveWorldInfo(name, data);
        value ? probabilityContainer.show() : probabilityContainer.hide();

        if (value && data.entries[uid].probability === null) {
            data.entries[uid].probability = 100;
        }

        if (!value) {
            data.entries[uid].probability = null;
        }

        probabilityInput.val(data.entries[uid].probability).trigger("input");
    });
    probabilityToggle.prop("checked", true /* entry.useProbability */).trigger("input");
    probabilityToggle.parent().hide();

    // position
    if (entry.position === undefined) {
        entry.position = 0;
    }

    const positionInput = template.find('select[name="position"]');
    positionInput.data("uid", entry.uid);
    positionInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = Number($(this).val());
        data.entries[uid].position = !isNaN(value) ? value : 0;
        // Spec v2 only supports before_char and after_char
        setOriginalDataValue(data, uid, "position", data.entries[uid].position == 0 ? 'before_char' : 'after_char');
        // Write the original value as extensions field
        setOriginalDataValue(data, uid, "extensions.position", data.entries[uid].position);
        saveWorldInfo(name, data);
    });

    template
        .find(`select[name="position"] option[value=${entry.position}]`)
        .prop("selected", true)
        .trigger("input");

    // display uid
    template.find(".world_entry_form_uid_value").text(entry.uid);

    // disable
    const disableInput = template.find('input[name="disable"]');
    disableInput.data("uid", entry.uid);
    disableInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).prop("checked");
        data.entries[uid].disable = value;
        setOriginalDataValue(data, uid, "enabled", !data.entries[uid].disable);
        saveWorldInfo(name, data);
    });
    disableInput.prop("checked", entry.disable).trigger("input");

    const excludeRecursionInput = template.find('input[name="exclude_recursion"]');
    excludeRecursionInput.data("uid", entry.uid);
    excludeRecursionInput.on("input", function () {
        const uid = $(this).data("uid");
        const value = $(this).prop("checked");
        data.entries[uid].excludeRecursion = value;
        setOriginalDataValue(data, uid, "extensions.exclude_recursion", data.entries[uid].excludeRecursion);
        saveWorldInfo(name, data);
    });
    excludeRecursionInput.prop("checked", entry.excludeRecursion).trigger("input");

    // delete button
    const deleteButton = template.find("input.delete_entry_button");
    deleteButton.data("uid", entry.uid);
    deleteButton.on("click", function () {
        const uid = $(this).data("uid");
        deleteWorldInfoEntry(data, uid);
        deleteOriginalDataValue(data, uid);
        $(this).closest(".world_entry").remove();
        saveWorldInfo(name, data);
    });

    template.appendTo("#world_popup_entries_list");
    template.find('.inline-drawer-content').css('display', 'none'); //entries start collapsed

    return template;
}

async function deleteWorldInfoEntry(data, uid) {
    if (!data || !("entries" in data)) {
        return;
    }

    delete data.entries[uid];
}

function createWorldInfoEntry(name, data) {
    const newEntryTemplate = {
        key: [],
        keysecondary: [],
        comment: "",
        content: "",
        constant: false,
        selective: false,
        addMemo: false,
        order: 100,
        position: 0,
        disable: false,
        excludeRecursion: false,
        probability: null,
        useProbability: false,
    };
    const newUid = getFreeWorldEntryUid(data);

    if (!Number.isInteger(newUid)) {
        console.error("Couldn't assign UID to a new entry");
        return;
    }

    const newEntry = { uid: newUid, ...newEntryTemplate };
    data.entries[newUid] = newEntry;

    const entryTemplate = appendWorldEntry(name, data, newEntry);
    entryTemplate.get(0).scrollIntoView({ behavior: "smooth" });
}

async function _save(name, data) {
    const response = await fetch("/editworldinfo", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: name, data: data }),
    });
}

async function saveWorldInfo(name, data, immediately) {
    if (!name || !data) {
        return;
    }

    delete worldInfoCache[name];

    if (immediately) {
        return await _save(name, data);
    }

    saveWorldDebounced(name, data);
}

async function renameWorldInfo(name, data) {
    const oldName = name;
    const newName = await callPopup("<h3>Rename World Info</h3>Enter a new name:", 'input', oldName);

    if (oldName === newName || !newName) {
        console.debug("World info rename cancelled");
        return;
    }

    const entryPreviouslySelected = selected_world_info.findIndex((e) => e === oldName);

    await saveWorldInfo(newName, data, true);
    await deleteWorldInfo(oldName);

    const existingCharLores = world_info.charLore?.filter((e) => e.extraBooks.includes(oldName));
    if (existingCharLores && existingCharLores.length > 0) {
        existingCharLores.forEach((charLore) => {
            const tempCharLore = charLore.extraBooks.filter((e) => e !== oldName);
            tempCharLore.push(newName);
            charLore.extraBooks = tempCharLore;
        });
        saveSettingsDebounced();
    }

    if (entryPreviouslySelected !== -1) {
        const wiElement = getWIElement(newName);
        wiElement.prop("selected", true);
        $("#world_info").trigger('change');
    }

    const selectedIndex = world_names.indexOf(newName);
    if (selectedIndex !== -1) {
        $('#world_editor_select').val(selectedIndex).trigger('change');
    }
}

async function deleteWorldInfo(worldInfoName) {
    if (!world_names.includes(worldInfoName)) {
        return;
    }

    const response = await fetch("/deleteworldinfo", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: worldInfoName }),
    });

    if (response.ok) {
        const existingWorldIndex = selected_world_info.findIndex((e) => e === worldInfoName);
        if (existingWorldIndex !== -1) {
            selected_world_info.splice(existingWorldIndex, 1);
            saveSettingsDebounced();
        }

        await updateWorldInfoList();
        $('#world_editor_select').trigger('change');

        if ($('#character_world').val() === worldInfoName) {
            $('#character_world').val('').trigger('change');
            setWorldInfoButtonClass(undefined, false);
            if (menu_type != 'create') {
                saveCharacterDebounced();
            }
        }
    }
}

function getFreeWorldEntryUid(data) {
    if (!data || !("entries" in data)) {
        return null;
    }

    const MAX_UID = 1_000_000; // <- should be safe enough :)
    for (let uid = 0; uid < MAX_UID; uid++) {
        if (uid in data.entries) {
            continue;
        }
        return uid;
    }

    return null;
}

function getFreeWorldName() {
    const MAX_FREE_NAME = 100_000;
    for (let index = 1; index < MAX_FREE_NAME; index++) {
        const newName = `New World (${index})`;
        if (world_names.includes(newName)) {
            continue;
        }
        return newName;
    }

    return undefined;
}

async function createNewWorldInfo(worldInfoName) {
    const worldInfoTemplate = { entries: {} };

    if (!worldInfoName) {
        return;
    }

    await saveWorldInfo(worldInfoName, worldInfoTemplate, true);
    await updateWorldInfoList();

    const selectedIndex = world_names.indexOf(worldInfoName);
    if (selectedIndex !== -1) {
        $('#world_editor_select').val(selectedIndex).trigger('change');
    } else {
        hideWorldEditor();
    }
}

// Gets a string that respects the case sensitivity setting
function transformString(str) {
    return world_info_case_sensitive ? str : str.toLowerCase();
}

async function getCharacterLore() {
    const character = characters[this_chid];
    const name = character?.name;
    let worldsToSearch = new Set();

    const baseWorldName = character?.data?.extensions?.world;
    if (baseWorldName) {
        worldsToSearch.add(baseWorldName);
    } else {
        console.debug(`Character ${name}'s base world could not be found or is empty! Skipping...`)
        return [];
    }

    // TODO: Maybe make the utility function not use the window context?
    const fileName = getCharaFilename(this_chid);
    const extraCharLore = world_info.charLore?.find((e) => e.name === fileName);
    if (extraCharLore) {
        worldsToSearch = new Set([...worldsToSearch, ...extraCharLore.extraBooks]);
    }

    let entries = [];
    for (const worldName of worldsToSearch) {
        if (selected_world_info.includes(worldName)) {
            console.debug(`Character ${name}'s world ${worldName} is already activated in global world info! Skipping...`);
            continue;
        }

        const data = await loadWorldInfoData(worldName);
        const newEntries = data ? Object.keys(data.entries).map((x) => data.entries[x]) : [];
        entries = entries.concat(newEntries);
    }

    console.debug(`Character ${characters[this_chid]?.name} lore (${baseWorldName}) has ${entries.length} world info entries`);
    return entries;
}

async function getGlobalLore() {
    if (!selected_world_info) {
        return [];
    }

    let entries = [];
    for (const worldName of selected_world_info) {
        const data = await loadWorldInfoData(worldName);
        const newEntries = data ? Object.keys(data.entries).map((x) => data.entries[x]) : [];
        entries = entries.concat(newEntries);
    }

    console.debug(`Global world info has ${entries.length} entries`);

    return entries;
}

async function getSortedEntries() {
    try {
        const globalLore = await getGlobalLore();
        const characterLore = await getCharacterLore();

        let entries;

        switch (Number(world_info_character_strategy)) {
            case world_info_insertion_strategy.evenly:
                console.debug('WI using evenly')
                entries = [...globalLore, ...characterLore].sort(sortFn);
                break;
            case world_info_insertion_strategy.character_first:
                console.debug('WI using char first')
                entries = [...characterLore.sort(sortFn), ...globalLore.sort(sortFn)];
                break;
            case world_info_insertion_strategy.global_first:
                console.debug('WI using global first')
                entries = [...globalLore.sort(sortFn), ...characterLore.sort(sortFn)];
                break;
            default:
                console.error("Unknown WI insertion strategy: ", world_info_character_strategy, "defaulting to evenly");
                entries = [...globalLore, ...characterLore].sort(sortFn);
                break;
        }

        console.debug(`Sorted ${entries.length} world lore entries using strategy ${world_info_character_strategy}`);

        return entries;
    }
    catch (e) {
        console.error(e);
        return [];
    }
}

async function checkWorldInfo(chat, maxContext) {
    const context = getContext();
    const messagesToLookBack = world_info_depth * 2 || 1;
    let textToScan = transformString(chat.slice(0, messagesToLookBack).join(""));
    let needsToScan = true;
    let count = 0;
    let allActivatedEntries = new Set();
    let failedProbabilityChecks = new Set();
    let allActivatedText = '';

    const budget = Math.round(world_info_budget * maxContext / 100) || 1;
    console.debug(`Context size: ${maxContext}; WI budget: ${budget} (${world_info_budget}%)`);
    const sortedEntries = await getSortedEntries();

    if (sortedEntries.length === 0) {
        return { worldInfoBefore: '', worldInfoAfter: '' };
    }

    while (needsToScan) {
        // Track how many times the loop has run
        count++;

        let activatedNow = new Set();

        for (let entry of sortedEntries) {
            if (failedProbabilityChecks.has(entry)) {
                continue;
            }

            if (allActivatedEntries.has(entry) || entry.disable == true || (count > 1 && world_info_recursive && entry.excludeRecursion)) {
                continue;
            }

            if (entry.constant) {
                activatedNow.add(entry);
                continue;
            }

            if (Array.isArray(entry.key) && entry.key.length) {
                primary: for (let key of entry.key) {
                    const substituted = substituteParams(key);
                    if (substituted && matchKeys(textToScan, substituted.trim())) {
                        if (
                            entry.selective &&
                            Array.isArray(entry.keysecondary) &&
                            entry.keysecondary.length
                        ) {
                            secondary: for (let keysecondary of entry.keysecondary) {
                                const secondarySubstituted = substituteParams(keysecondary);
                                if (secondarySubstituted && matchKeys(textToScan, secondarySubstituted.trim())) {
                                    activatedNow.add(entry);
                                    break secondary;
                                }
                            }
                        } else {
                            activatedNow.add(entry);
                            break primary;
                        }
                    }
                }
            }
        }

        needsToScan = world_info_recursive && activatedNow.size > 0;
        const newEntries = [...activatedNow]
            .sort((a, b) => sortedEntries.indexOf(a) - sortedEntries.indexOf(b));
        let newContent = "";
        const textToScanTokens = getTokenCount(allActivatedText);
        const probabilityChecksBefore = failedProbabilityChecks.size;

        for (const entry of newEntries) {
            const rollValue = Math.random() * 100;

            if (entry.useProbability && rollValue > entry.probability) {
                console.debug(`WI entry ${entry.key} failed probability check, skipping`);
                failedProbabilityChecks.add(entry);
                continue;
            }

            newContent += `${substituteParams(entry.content)}\n`;

            if (textToScanTokens + getTokenCount(newContent) >= budget) {
                console.debug(`WI budget reached, stopping`);
                needsToScan = false;
                break;
            }

            allActivatedEntries.add(entry);
            console.debug('WI entry activated:', entry);
        }

        const probabilityChecksAfter = failedProbabilityChecks.size;

        if ((probabilityChecksAfter - probabilityChecksBefore) === activatedNow.size) {
            console.debug(`WI probability checks failed for all activated entries, stopping`);
            needsToScan = false;
        }

        if (needsToScan) {
            const text = newEntries
                .filter(x => !failedProbabilityChecks.has(x))
                .map(x => x.content).join('\n');
            const currentlyActivatedText = transformString(text);
            textToScan = (currentlyActivatedText + '\n' + textToScan);
            allActivatedText = (currentlyActivatedText + '\n' + allActivatedText);
        }
    }

    // Forward-sorted list of entries for joining
    const WIBeforeEntries = [];
    const WIAfterEntries = [];
    const ANTopEntries = [];
    const ANBottomEntries = [];

    // Appends from insertion order 999 to 1. Use unshift for this purpose
    [...allActivatedEntries].sort(sortFn).forEach((entry) => {
        switch (entry.position) {
            case world_info_position.before:
                WIBeforeEntries.unshift(substituteParams(entry.content));
                break;
            case world_info_position.after:
                WIAfterEntries.unshift(substituteParams(entry.content));
                break;
            case world_info_position.ANTop:
                ANTopEntries.unshift(entry.content);
                break;
            case world_info_position.ANBottom:
                ANBottomEntries.unshift(entry.content);
                break;
            default:
                break;
        }
    });

    const worldInfoBefore = WIBeforeEntries.length ? `${WIBeforeEntries.join("\n")}\n` : '';
    const worldInfoAfter = WIAfterEntries.length ? `${WIAfterEntries.join("\n")}\n` : '';

    if (shouldWIAddPrompt) {
        const originalAN = context.extensionPrompts[NOTE_MODULE_NAME].value;
        const ANWithWI = `${ANTopEntries.join("\n")}\n${originalAN}\n${ANBottomEntries.join("\n")}`
        context.setExtensionPrompt(NOTE_MODULE_NAME, ANWithWI, chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth]);
    }

    return { worldInfoBefore, worldInfoAfter };
}

function matchKeys(haystack, needle) {
    const transformedString = transformString(needle);

    if (world_info_match_whole_words) {
        const keyWords = transformedString.split(/\s+/);

        if (keyWords.length > 1) {
            return haystack.includes(transformedString);
        }
        else {
            const regex = new RegExp(`\\b${transformedString}\\b`);
            if (regex.test(haystack)) {
                return true;
            }
        }

    } else {
        return haystack.includes(transformedString);
    }

    return false;
}

function convertAgnaiMemoryBook(inputObj) {
    const outputObj = { entries: {} };

    inputObj.entries.forEach((entry, index) => {
        outputObj.entries[index] = {
            uid: index,
            key: entry.keywords,
            keysecondary: [],
            comment: entry.name,
            content: entry.entry,
            constant: false,
            selective: false,
            order: entry.weight,
            position: 0,
            disable: !entry.enabled,
            addMemo: !!entry.name,
            excludeRecursion: false,
            displayIndex: index,
            probability: null,
            useProbability: false,
        };
    });

    return outputObj;
}

function convertRisuLorebook(inputObj) {
    const outputObj = { entries: {} };

    inputObj.data.forEach((entry, index) => {
        outputObj.entries[index] = {
            uid: index,
            key: entry.key.split(',').map(x => x.trim()),
            keysecondary: entry.secondkey ? entry.secondkey.split(',').map(x => x.trim()) : [],
            comment: entry.comment,
            content: entry.content,
            constant: entry.alwaysActive,
            selective: entry.selective,
            order: entry.insertorder,
            position: world_info_position.before,
            disable: false,
            addMemo: true,
            excludeRecursion: false,
            displayIndex: index,
            probability: entry.activationPercent ?? null,
            useProbability: entry.activationPercent ?? false,
        };
    });

    return outputObj;
}

function convertNovelLorebook(inputObj) {
    const outputObj = {
        entries: {}
    };

    inputObj.entries.forEach((entry, index) => {
        const displayName = entry.displayName;
        const addMemo = displayName !== undefined && displayName.trim() !== '';

        outputObj.entries[index] = {
            uid: index,
            key: entry.keys,
            keysecondary: [],
            comment: displayName || '',
            content: entry.text,
            constant: false,
            selective: false,
            order: entry.contextConfig?.budgetPriority ?? 0,
            position: 0,
            disable: !entry.enabled,
            addMemo: addMemo,
            excludeRecursion: false,
            displayIndex: index,
            probability: null,
            useProbability: false,
        };
    });

    return outputObj;
}

function convertCharacterBook(characterBook) {
    const result = { entries: {}, originalData: characterBook };

    characterBook.entries.forEach((entry, index) => {
        // Not in the spec, but this is needed to find the entry in the original data
        if (entry.id === undefined) {
            entry.id = index;
        }

        result.entries[entry.id] = {
            uid: entry.id,
            key: entry.keys,
            keysecondary: entry.secondary_keys || [],
            comment: entry.comment || "",
            content: entry.content,
            constant: entry.constant || false,
            selective: entry.selective || false,
            order: entry.insertion_order,
            position: entry.extensions?.position ?? (entry.position === "before_char" ? world_info_position.before : world_info_position.after),
            excludeRecursion: entry.extensions?.exclude_recursion ?? false,
            disable: !entry.enabled,
            addMemo: entry.comment ? true : false,
            displayIndex: entry.extensions?.display_index ?? index,
            probability: entry.extensions?.probability ?? null,
            useProbability: entry.extensions?.useProbability ?? false,
        };
    });

    return result;
}

export function setWorldInfoButtonClass(chid, forceValue = undefined) {
    if (forceValue !== undefined) {
        $('#set_character_world, #world_button').toggleClass('world_set', forceValue);
        return;
    }

    if (!chid) {
        return;
    }

    const world = characters[chid]?.data?.extensions?.world;
    const worldSet = Boolean(world && world_names.includes(world));
    $('#set_character_world, #world_button').toggleClass('world_set', worldSet);
}

export function checkEmbeddedWorld(chid) {
    $('#import_character_info').hide();

    if (chid === undefined) {
        return false;
    }

    if (characters[chid]?.data?.character_book) {
        $('#import_character_info').data('chid', chid).show();

        // Only show the alert once per character
        const checkKey = `AlertWI_${characters[chid].avatar}`;
        const worldName = characters[chid]?.data?.extensions?.world;
        if (!localStorage.getItem(checkKey) && (!worldName || !world_names.includes(worldName))) {
            toastr.info(
                'To import and use it, select "Import Embedded World Info" in the Options dropdown menu on the character panel.',
                `${characters[chid].name} has an embedded World/Lorebook`,
                { timeOut: 10000, extendedTimeOut: 20000, positionClass: 'toast-top-center' },
            );
            localStorage.setItem(checkKey, 1);
        }
        return true;
    }

    return false;
}

export async function importEmbeddedWorldInfo() {
    const chid = $('#import_character_info').data('chid');

    if (chid === undefined) {
        return;
    }

    const bookName = characters[chid]?.data?.character_book?.name || `${characters[chid]?.name}'s Lorebook`;
    const confirmationText = (`<h3>Are you sure you want to import "${bookName}"?</h3>`) + (world_names.includes(bookName) ? 'It will overwrite the World/Lorebook with the same name.' : '');

    const confirmation = await callPopup(confirmationText, 'confirm');

    if (!confirmation) {
        return;
    }

    const convertedBook = convertCharacterBook(characters[chid].data.character_book);

    await saveWorldInfo(bookName, convertedBook, true);
    await updateWorldInfoList();
    $('#character_world').val(bookName).trigger('change');

    toastr.success(`The world "${bookName}" has been imported and linked to the character successfully.`, 'World/Lorebook imported');

    const newIndex = world_names.indexOf(bookName);
    if (newIndex >= 0) {
        $("#world_editor_select").val(newIndex).trigger('change');
    }

    setWorldInfoButtonClass(chid, true);
}

function onWorldInfoChange(_, text) {
    let selectedWorlds;
    if (_ !== '__notSlashCommand__') { // if it's a slash command
        if (text !== undefined) { // and args are provided
            const slashInputSplitText = text.trim().toLowerCase().split(",");

            slashInputSplitText.forEach((worldName) => {
                const wiElement = getWIElement(worldName);
                if (wiElement.length > 0) {
                    wiElement.prop("selected", true);
                    toastr.success(`Activated world: ${wiElement.text()}`);
                } else {
                    toastr.error(`No world found named: ${worldName}`);
                }
            })
        } else { // if no args, unset all worlds
            toastr.success('Deactivated all worlds');
            selected_world_info = [];
            $("#world_info").val("");
        }
    } else { //if it's a pointer selection
        let tempWorldInfo = [];
        let selectedWorlds = $("#world_info").val().map((e) => Number(e)).filter((e) => !isNaN(e));
        if (selectedWorlds.length > 0) {
            selectedWorlds.forEach((worldIndex) => {
                const existingWorldName = world_names[worldIndex];
                if (existingWorldName) {
                    tempWorldInfo.push(existingWorldName);
                } else {
                    const wiElement = getWIElement(existingWorldName);
                    wiElement.prop("selected", false);
                    toastr.error(`The world with ${existingWorldName} is invalid or corrupted.`);
                }
            });
        }
        selected_world_info = tempWorldInfo;
    }

    saveSettingsDebounced();
}

export async function importWorldInfo(file) {
    if (!file) {
        return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        let jsonData;

        if (file.name.endsWith('.png')) {
            const buffer = new Uint8Array(await getFileBuffer(file));
            jsonData = extractDataFromPng(buffer, 'naidata');
        } else {
            // File should be a JSON file
            jsonData = await parseJsonFile(file);
        }

        if (jsonData === undefined || jsonData === null) {
            toastr.error(`File is not valid: ${file.name}`);
            return;
        }

        // Convert Novel Lorebook
        if (jsonData.lorebookVersion !== undefined) {
            console.log('Converting Novel Lorebook');
            formData.append('convertedData', JSON.stringify(convertNovelLorebook(jsonData)));
        }

        // Convert Agnai Memory Book
        if (jsonData.kind === 'memory') {
            console.log('Converting Agnai Memory Book');
            formData.append('convertedData', JSON.stringify(convertAgnaiMemoryBook(jsonData)));
        }

        // Convert Risu Lorebook
        if (jsonData.type === 'risu') {
            console.log('Converting Risu Lorebook');
            formData.append('convertedData', JSON.stringify(convertRisuLorebook(jsonData)));
        }
    } catch (error) {
        toastr.error(`Error parsing file: ${error}`);
        return;
    }

    jQuery.ajax({
        type: "POST",
        url: "/importworldinfo",
        data: formData,
        beforeSend: () => { },
        cache: false,
        contentType: false,
        processData: false,
        success: async function (data) {
            if (data.name) {
                await updateWorldInfoList();

                const newIndex = world_names.indexOf(data.name);
                if (newIndex >= 0) {
                    $("#world_editor_select").val(newIndex).trigger('change');
                }

                toastr.info(`World Info "${data.name}" imported successfully!`);
            }
        },
        error: (jqXHR, exception) => { },
    });
}

jQuery(() => {

    $(document).ready(function () {
        registerSlashCommand('world', onWorldInfoChange, [], "– sets active World, or unsets if no args provided", true, true);
    })


    $("#world_info").on('mousedown change', async function (e) {
        // If there's no world names, don't do anything
        if (world_names.length === 0) {
            e.preventDefault();
            return;
        }

        /*
        if (deviceInfo.device.type === 'desktop') {
            let selectScrollTop = null;
            e.preventDefault();
            const option = $(e.target);
            const selectElement = $(this)[0];
            selectScrollTop = selectElement.scrollTop;
            option.prop('selected', !option.prop('selected'));
            await delay(1);
            selectElement.scrollTop = selectScrollTop;
        }
        */

        onWorldInfoChange('__notSlashCommand__');
    });

    //**************************WORLD INFO IMPORT EXPORT*************************//
    $("#world_import_button").on('click', function () {
        $("#world_import_file").trigger('click');
    });

    $("#world_import_file").on("change", async function (e) {
        const file = e.target.files[0];

        await importWorldInfo(file);

        // Will allow to select the same file twice in a row
        $("#form_world_import").trigger("reset");
    });

    $("#world_create_button").on('click', async () => {
        const tempName = getFreeWorldName();
        const finalName = await callPopup("<h3>Create a new World Info?</h3>Enter a name for the new file:", "input", tempName);

        if (finalName) {
            await createNewWorldInfo(finalName);
        }
    });

    $("#world_editor_select").on('change', async () => {
        const selectedIndex = $("#world_editor_select").find(":selected").val();

        if (selectedIndex === "") {
            hideWorldEditor();
        } else {
            const worldName = world_names[selectedIndex];
            showWorldEditor(worldName);
        }
    });

    $(document).on("input", "#world_info_depth", function () {
        world_info_depth = Number($(this).val());
        $("#world_info_depth_counter").text($(this).val());
        saveSettingsDebounced();
    });

    $(document).on("input", "#world_info_budget", function () {
        world_info_budget = Number($(this).val());
        $("#world_info_budget_counter").text($(this).val());
        saveSettingsDebounced();
    });

    $(document).on("input", "#world_info_recursive", function () {
        world_info_recursive = !!$(this).prop('checked');
        saveSettingsDebounced();
    })

    $('#world_info_case_sensitive').on('input', function () {
        world_info_case_sensitive = !!$(this).prop('checked');
        saveSettingsDebounced();
    })

    $('#world_info_match_whole_words').on('input', function () {
        world_info_match_whole_words = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#world_info_character_strategy').on('change', function () {
        world_info_character_strategy = $(this).val();
        saveSettingsDebounced();
    });

    $('#world_button').on('click', async function () {
        const chid = $('#set_character_world').data('chid');

        if (chid) {
            const worldName = characters[chid]?.data?.extensions?.world;
            const hasEmbed = checkEmbeddedWorld(chid);
            if (worldName && world_names.includes(worldName)) {
                if (!$('#WorldInfo').is(':visible')) {
                    $('#WIDrawerIcon').trigger('click');
                }
                const index = world_names.indexOf(worldName);
                $("#world_editor_select").val(index).trigger('change');
            } else if (hasEmbed) {
                await importEmbeddedWorldInfo();
                saveCharacterDebounced();
            }
            else {
                $('#char-management-dropdown').val($('#set_character_world').val()).trigger('change');
            }
        }
    });

    /*
    $("#world_info").on('mousewheel', function (e) {
        e.preventDefault();
        if ($(this).is(':animated')) {
            return; //dont force multiple scroll animations
        }
        var wheelDelta = e.originalEvent.wheelDelta.toFixed(0);
        var DeltaPosNeg = (wheelDelta >= 0) ? 1 : -1; //determine if scrolling up or down
        var containerHeight = $(this).height().toFixed(0);
        var optionHeight = $(this).find('option').first().height().toFixed(0);
        var visibleOptions = (containerHeight / optionHeight).toFixed(0); //how many options we can see
        var pixelsToScroll = (optionHeight * visibleOptions * DeltaPosNeg).toFixed(0); //scroll a full container height
        var scrollTop = ($(this).scrollTop() - pixelsToScroll).toFixed(0);

        $(this).animate({ scrollTop: scrollTop }, 200);
    });
    */

    // Not needed on mobile
    if (deviceInfo.device.type === 'desktop') {
        $('#world_info').select2({
            width: '100%',
            placeholder: 'No Worlds active. Click here to select.',
            allowClear: true,
            closeOnSelect: false,
        });
    }
})
