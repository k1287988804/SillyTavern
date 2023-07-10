import {
    characters,
    saveSettingsDebounced,
    this_chid,
    callPopup,
    menu_type,
    updateVisibleDivs,
    getCharacters,
} from "../script.js";

import { selected_group } from "./group-chats.js";

export {
    tags,
    tag_map,
    loadTagsSettings,
    printTagFilters,
    isElementTagged,
    getTagsList,
    appendTagToList,
    createTagMapFromList,
    renameTagKey,
    importTags,
};

const random_id = () => Math.round(Date.now() * Math.random()).toString();
const TAG_LOGIC_AND = true; // switch to false to use OR logic for combining tags
const CHARACTER_SELECTOR = '#rm_print_characters_block > div';
const GROUP_MEMBER_SELECTOR = '#rm_group_add_members > div';
const CHARACTER_FILTER_SELECTOR = '#rm_characters_block .rm_tag_filter';
const GROUP_FILTER_SELECTOR = '#rm_group_chats_block .rm_tag_filter';

function getCharacterSelector(listSelector) {
    if ($(listSelector).is(GROUP_FILTER_SELECTOR)) {
        return GROUP_MEMBER_SELECTOR;
    }

    return CHARACTER_SELECTOR;
}

export const tag_filter_types = {
    character: 0,
    group_member: 1,
};

const ACTIONABLE_TAGS = {

    FAV: { id: 1, name: 'Show only favorites', color: 'rgba(255, 255, 0, 0.5)', action: applyFavFilter, icon: 'fa-solid fa-star', class: 'filterByFavorites' },
    GROUP: { id: 0, name: 'Show only groups', color: 'rgba(100, 100, 100, 0.5)', action: filterByGroups, icon: 'fa-solid fa-users', class: 'filterByGroups' },
    HINT: { id: 3, name: 'Show Tag List', color: 'rgba(150, 100, 100, 0.5)', action: onTagListHintClick, icon: 'fa-solid fa-tags', class: 'showTagList' },
}

const InListActionable = {
    VIEW: { id: 2, name: 'Manage tags', color: 'rgba(150, 100, 100, 0.5)', action: onViewTagsListClick, icon: 'fa-solid fa-gear' },
}

const DEFAULT_TAGS = [
    { id: random_id(), name: "Plain Text" },
    { id: random_id(), name: "OpenAI" },
    { id: random_id(), name: "W++" },
    { id: random_id(), name: "Boostyle" },
    { id: random_id(), name: "PList" },
    { id: random_id(), name: "AliChat" },
];

let tags = [];
let tag_map = {};

function applyFavFilter(characterSelector) {
    const isSelected = $(this).hasClass('selected');
    const displayFavoritesOnly = !isSelected;

    $(this).toggleClass('selected', displayFavoritesOnly);
    $(characterSelector).removeClass('hiddenByFav');

    $(characterSelector).each(function () {
        if (displayFavoritesOnly) {
            if ($(this).find(".ch_fav").length !== 0) {
                const shouldBeDisplayed = $(this).find(".ch_fav").val().toLowerCase().includes(true);
                $(this).toggleClass('hiddenByFav', !shouldBeDisplayed);
            }
        }

    });
    updateVisibleDivs('#rm_print_characters_block', true);
}

function filterByGroups(characterSelector) {
    const isSelected = $(this).hasClass('selected');
    const displayGroupsOnly = !isSelected;
    $(this).toggleClass('selected', displayGroupsOnly);
    $(characterSelector).removeClass('hiddenByGroup');

    $(characterSelector).each((_, element) => {
        $(element).toggleClass('hiddenByGroup', displayGroupsOnly && !$(element).hasClass('group_select'));
    });
    updateVisibleDivs('#rm_print_characters_block', true);
}

function loadTagsSettings(settings) {
    tags = settings.tags !== undefined ? settings.tags : DEFAULT_TAGS;
    tag_map = settings.tag_map !== undefined ? settings.tag_map : Object.create(null);
}

function renameTagKey(oldKey, newKey) {
    const value = tag_map[oldKey];
    tag_map[newKey] = value || [];
    delete tag_map[oldKey];
    saveSettingsDebounced();
}

function createTagMapFromList(listElement, key) {
    const tagIds = [...($(listElement).find(".tag").map((_, el) => $(el).attr("id")))];
    tag_map[key] = tagIds;
    saveSettingsDebounced();
}

function getTagsList(key) {
    if (!Array.isArray(tag_map[key])) {
        tag_map[key] = [];
        return [];
    }

    return tag_map[key]
        .map(x => tags.find(y => y.id === x))
        .filter(x => x)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function getInlineListSelector() {
    if (selected_group && menu_type === "group_edit") {
        return `.group_select[grid="${selected_group}"] .tags`;
    }

    if (this_chid && menu_type === "character_edit") {
        return `.character_select[chid="${this_chid}"] .tags`;
    }

    return null;
}

function getTagKey() {
    if (selected_group && menu_type === "group_edit") {
        return selected_group;
    }

    if (this_chid && menu_type === "character_edit") {
        return characters[this_chid].avatar;
    }

    return null;
}

function addTagToMap(tagId) {
    const key = getTagKey();

    if (!key) {
        return;
    }

    if (!Array.isArray(tag_map[key])) {
        tag_map[key] = [tagId];
    }
    else {
        tag_map[key].push(tagId);
    }
}

function removeTagFromMap(tagId) {
    const key = getTagKey();

    if (!key) {
        return;
    }

    if (!Array.isArray(tag_map[key])) {
        tag_map[key] = [];
    }
    else {
        const indexOf = tag_map[key].indexOf(tagId);
        tag_map[key].splice(indexOf, 1);
    }
}

function findTag(request, resolve, listSelector) {
    const skipIds = [...($(listSelector).find(".tag").map((_, el) => $(el).attr("id")))];
    const haystack = tags.filter(t => !skipIds.includes(t.id)).map(t => t.name).sort();
    const needle = request.term.toLowerCase();
    const hasExactMatch = haystack.findIndex(x => x.toLowerCase() == needle) !== -1;
    const result = haystack.filter(x => x.toLowerCase().includes(needle));

    if (request.term && !hasExactMatch) {
        result.unshift(request.term);
    }

    resolve(result);
}

function selectTag(event, ui, listSelector) {
    let tagName = ui.item.value;
    let tag = tags.find(t => t.name === tagName);

    // create new tag if it doesn't exist
    if (!tag) {
        tag = createNewTag(tagName);
    }

    // unfocus and clear the input
    $(event.target).val("").trigger('blur');

    // add tag to the UI and internal map
    appendTagToList(listSelector, tag, { removable: true });
    appendTagToList(getInlineListSelector(), tag, { removable: false });
    addTagToMap(tag.id);
    saveSettingsDebounced();
    printTagFilters(tag_filter_types.character);
    printTagFilters(tag_filter_types.group_member);

    // need to return false to keep the input clear
    return false;
}

function getExistingTags(new_tags) {
    let existing_tags = [];
    for (let tag of new_tags) {
        let foundTag = tags.find(t => t.name.toLowerCase() === tag.toLowerCase())
        if (foundTag) {
            existing_tags.push(foundTag.name);
        }
    }
    return existing_tags
}


async function importTags(imported_char) {
    let imported_tags = imported_char.tags.filter(t => t !== "ROOT" && t !== "TAVERN");
    let existingTags = await getExistingTags(imported_tags);
    //make this case insensitive
    let newTags = imported_tags.filter(t => !existingTags.some(existingTag => existingTag.toLowerCase() === t.toLowerCase()));
    let selected_tags = "";
    const existingTagsString = existingTags.length ? (': ' + existingTags.join(', ')) : '';
    if (newTags.length === 0) {
        await callPopup(`<h3>Importing Tags</h3><p>${existingTags.length} existing tags have been found${existingTagsString}.</p>`, 'text');
    } else {
        selected_tags = await callPopup(`<h3>Importing Tags</h3><p>${existingTags.length} existing tags have been found${existingTagsString}.</p><p>The following ${newTags.length} new tags will be imported.</p>`, 'input', newTags.join(', '));
    }
    selected_tags = existingTags.concat(selected_tags.split(','));
    selected_tags = selected_tags.map(t => t.trim()).filter(t => t !== "");
    //Anti-troll measure
    if (selected_tags.length > 15) {
        selected_tags = selected_tags.slice(0, 15);
    }
    for (let tagName of selected_tags) {
        let tag = tags.find(t => t.name === tagName);

        if (!tag) {
            tag = createNewTag(tagName);
        }

        addTagToMap(tag.id);
        tag_map[imported_char.avatar].push(tag.id);
    };
    saveSettingsDebounced();
    await getCharacters();
    await getSettings();
    printTagFilters(tag_filter_types.character);
    printTagFilters(tag_filter_types.group_member);

    // need to return false to keep the input clear
    return false;
}


function createNewTag(tagName) {
    const tag = {
        id: random_id(),
        name: tagName,
        color: '',
    };
    tags.push(tag);
    return tag;
}

function appendTagToList(listElement, tag, { removable, selectable, action, isGeneralList }) {
    if (!listElement) {
        return;
    }

    const characterSelector = getCharacterSelector($(listElement));

    let tagElement = $('#tag_template .tag').clone();
    tagElement.attr('id', tag.id);

    tagElement.css('color', 'var(--SmartThemeBodyColor)');
    tagElement.css('background-color', tag.color);

    tagElement.find('.tag_name').text(tag.name);
    const removeButton = tagElement.find(".tag_remove");
    removable ? removeButton.show() : removeButton.hide();

    if (tag.class) {
        tagElement.addClass(tag.class);
    }

    if (tag.icon) {
        tagElement.find('.tag_name').text('').attr('title', tag.name).addClass(tag.icon);
    }

    if (tag.excluded) {
        isGeneralList ? $(tagElement).addClass('excluded') : $(listElement).parent().parent().addClass('hiddenByTag');
    }

    if (selectable) {
        tagElement.on('click', () => onTagFilterClick.bind(tagElement)(listElement, characterSelector));
    }

    if (action) {
        tagElement.on('click', () => action.bind(tagElement)(characterSelector));
        tagElement.addClass('actionable');
    }
    if (action && tag.id === 2) {
        tagElement.addClass('innerActionable hidden');
    }

    $(listElement).append(tagElement);
}

function onTagFilterClick(listElement, characterSelector) { 
    let excludeTag;
    if ($(this).hasClass('selected')) {
        $(this).removeClass('selected');
        $(this).addClass('excluded');
        excludeTag = true
    }
    else if ($(this).hasClass('excluded')) {
        $(this).removeClass('excluded');
        excludeTag = false;
    }
    else {
        $(this).addClass('selected');
    }

    // Manual undefined check required for three-state boolean
    if (excludeTag !== undefined) {
        const tagId = $(this).attr('id');
        const existingTag = tags.find((tag) => tag.id === tagId);
        if (existingTag) {
            existingTag.excluded = excludeTag;

            saveSettingsDebounced();
        }
    }

    // TODO: Overhaul this somehow to use settings tag IDs instead
    const tagIds = [...($(listElement).find(".tag.selected:not(.actionable)").map((_, el) => $(el).attr("id")))];
    const excludedTagIds = [...($(listElement).find(".tag.excluded:not(.actionable)").map((_, el) => $(el).attr("id")))];
    $(characterSelector).each((_, element) => applyFilterToElement(tagIds, excludedTagIds, element));
    updateVisibleDivs('#rm_print_characters_block', true);
}

function applyFilterToElement(tagIds, excludedTagIds, element) {
    const tagFlags = tagIds.map(tagId => isElementTagged(element, tagId));
    const trueFlags = tagFlags.filter(x => x);
    const isTagged = TAG_LOGIC_AND ? tagFlags.length === trueFlags.length : trueFlags.length > 0;

    const excludedTagFlags = excludedTagIds.map(tagId => isElementTagged(element, tagId));
    const isExcluded = excludedTagFlags.includes(true);

    if (isExcluded) {
        $(element).addClass('hiddenByTag');
    } else if (tagIds.length > 0 && !isTagged) {
        $(element).addClass('hiddenByTag');
    } else {
        $(element).removeClass('hiddenByTag');
    }
}

function isElementTagged(element, tagId) {
    const isGroup = $(element).hasClass('group_select');
    const isCharacter = $(element).hasClass('character_select') || $(element).hasClass('group_member');
    const idAttr = isGroup ? 'grid' : 'chid';
    const elementId = $(element).attr(idAttr);
    const lookupValue = isCharacter ? characters[elementId].avatar : elementId;
    const isTagged = Array.isArray(tag_map[lookupValue]) && tag_map[lookupValue].includes(tagId);
    return isTagged;
}

function clearTagsFilter(characterSelector) {
    $('.rm_tag_filter .tag').removeClass('selected');
    $(characterSelector).removeClass('hiddenByTag');
}

function printTagFilters(type = tag_filter_types.character) {
    const FILTER_SELECTOR = type === tag_filter_types.character ? CHARACTER_FILTER_SELECTOR : GROUP_FILTER_SELECTOR;
    const selectedTagIds = [...($(FILTER_SELECTOR).find(".tag.selected").map((_, el) => $(el).attr("id")))];
    $(FILTER_SELECTOR).empty();
    const characterTagIds = Object.values(tag_map).flat();
    const tagsToDisplay = tags
        .filter(x => characterTagIds.includes(x.id))
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const tag of Object.values(ACTIONABLE_TAGS)) {
        appendTagToList(FILTER_SELECTOR, tag, { removable: false, selectable: false, action: tag.action, isGeneralList: true });
    }

    $(FILTER_SELECTOR).find('.actionable').last().addClass('margin-right-10px');

    for (const tag of Object.values(InListActionable)) {
        appendTagToList(FILTER_SELECTOR, tag, { removable: false, selectable: false, action: tag.action, isGeneralList: true });
    }
    for (const tag of tagsToDisplay) {
        appendTagToList(FILTER_SELECTOR, tag, { removable: false, selectable: true, isGeneralList: true });
    }

    for (const tagId of selectedTagIds) {
        $(`${FILTER_SELECTOR} .tag[id="${tagId}"]`).trigger('click');
    }
}

function onTagRemoveClick(event) {
    event.stopPropagation();
    const tag = $(this).closest(".tag");
    const tagId = tag.attr("id");
    tag.remove();
    removeTagFromMap(tagId);
    $(`${getInlineListSelector()} .tag[id="${tagId}"]`).remove();

    printTagFilters(tag_filter_types.character);
    printTagFilters(tag_filter_types.group_member);
    saveSettingsDebounced();
}

function onTagInput(event) {
    let val = $(this).val();
    if (tags.find(t => t.name === val)) return;
    $(this).autocomplete("search", val);
}

function onTagInputFocus() {
    $(this).autocomplete('search', $(this).val());
}

function onCharacterCreateClick() {
    $("#tagList").empty();
}

function onGroupCreateClick() {
    $("#groupTagList").empty();
    printTagFilters(tag_filter_types.character);
    printTagFilters(tag_filter_types.group_member);
}

export function applyTagsOnCharacterSelect() {
    //clearTagsFilter();
    const chid = Number($(this).attr('chid'));
    const key = characters[chid].avatar;
    const tags = getTagsList(key);

    $("#tagList").empty();

    for (const tag of tags) {
        appendTagToList("#tagList", tag, { removable: true });
    }
}

function applyTagsOnGroupSelect() {
    //clearTagsFilter();
    const key = $(this).attr('grid');
    const tags = getTagsList(key);

    $("#groupTagList").empty();
    printTagFilters(tag_filter_types.character);
    printTagFilters(tag_filter_types.group_member);

    for (const tag of tags) {
        appendTagToList("#groupTagList", tag, { removable: true });
    }
}

function createTagInput(inputSelector, listSelector) {
    $(inputSelector)
        .autocomplete({
            source: (i, o) => findTag(i, o, listSelector),
            select: (e, u) => selectTag(e, u, listSelector),
            minLength: 0,
        })
        .focus(onTagInputFocus); // <== show tag list on click
}

function onViewTagsListClick() {
    $('#dialogue_popup').addClass('large_dialogue_popup');
    const list = document.createElement('div');
    const everything = Object.values(tag_map).flat();
    $(list).append('<h3>Tags</h3><i>Click on the tag name to edit it.</i><br>');
    $(list).append('<i>Click on color box to assign new color.</i><br><br>');

    for (const tag of tags) {
        const count = everything.filter(x => x == tag.id).length;
        const template = $('#tag_view_template .tag_view_item').clone();
        template.attr('id', tag.id);
        template.find('.tag_view_counter_value').text(count);
        template.find('.tag_view_name').text(tag.name);
        template.find('.tag_view_name').addClass('tag');
        template.find('.tag_view_name').css('background-color', tag.color);
        const colorPickerId = tag.id + "-tag-color";
        template.find('.tagColorPickerHolder').html(
            `<toolcool-color-picker id="${colorPickerId}" color="${tag.color}" class="tag-color"></toolcool-color-picker>`
        );

        template.find('.tag-color').attr('id', colorPickerId);
        list.appendChild(template.get(0));

        setTimeout(function () {
            document.querySelector(`.tag-color[id="${colorPickerId}"`).addEventListener('change', (evt) => {
                onTagColorize(evt);
            });
        }, 100);

        $(colorPickerId).color = tag.color;

    }
    callPopup(list.outerHTML, 'text');
}

function onTagDeleteClick() {
    if (!confirm("Are you sure?")) {
        return;
    }

    const id = $(this).closest('.tag_view_item').attr('id');
    for (const key of Object.keys(tag_map)) {
        tag_map[key] = tag_map[key].filter(x => x.id !== id);
    }
    const index = tags.findIndex(x => x.id === id);
    tags.splice(index, 1);
    $(`.tag[id="${id}"]`).remove();
    $(`.tag_view_item[id="${id}"]`).remove();
    saveSettingsDebounced();
}

function onTagRenameInput() {
    const id = $(this).closest('.tag_view_item').attr('id');
    const newName = $(this).text();
    const tag = tags.find(x => x.id === id);
    tag.name = newName;
    $(`.tag[id="${id}"] .tag_name`).text(newName);
    saveSettingsDebounced();
}

function onTagColorize(evt) {
    console.debug(evt);
    const id = $(evt.target).closest('.tag_view_item').attr('id');
    const newColor = evt.detail.rgba;
    $(evt.target).parent().parent().find('.tag_view_name').css('background-color', newColor);
    $(`.tag[id="${id}"]`).css('background-color', newColor);
    const tag = tags.find(x => x.id === id);
    tag.color = newColor;
    console.debug(tag);
    saveSettingsDebounced();
}

function onTagListHintClick() {
    console.log($(this));
    $(this).toggleClass('selected');
    $(this).siblings(".tag:not(.actionable)").toggle(100);
    $(this).siblings(".innerActionable").toggleClass('hidden');
}

$(document).ready(() => {
    createTagInput('#tagInput', '#tagList');
    createTagInput('#groupTagInput', '#groupTagList');

    $(document).on("click", "#rm_button_create", onCharacterCreateClick);
    $(document).on("click", "#rm_button_group_chats", onGroupCreateClick);
    $(document).on("click", ".character_select", applyTagsOnCharacterSelect);
    $(document).on("click", ".group_select", applyTagsOnGroupSelect);
    $(document).on("click", ".tag_remove", onTagRemoveClick);
    $(document).on("input", ".tag_input", onTagInput);
    $(document).on("click", ".tags_view", onViewTagsListClick);
    $(document).on("click", ".tag_delete", onTagDeleteClick);
    $(document).on("input", ".tag_view_name", onTagRenameInput);
});
