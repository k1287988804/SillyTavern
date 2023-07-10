import { getStringHash, debounce, waitUntilCondition } from "../../utils.js";
import { getContext, getApiUrl, extension_settings, doExtrasFetch, modules } from "../../extensions.js";
import { eventSource, event_types, extension_prompt_types, generateQuietPrompt, is_send_press, saveSettingsDebounced, substituteParams } from "../../../script.js";
export { MODULE_NAME };

const MODULE_NAME = '1_memory';

let lastCharacterId = null;
let lastGroupId = null;
let lastChatId = null;
let lastMessageHash = null;
let lastMessageId = null;
let inApiCall = false;

const formatMemoryValue = (value) => value ? `Summary: ${value.trim()}` : '';
const saveChatDebounced = debounce(() => getContext().saveChat(), 2000);

const summary_sources = {
    'extras': 'extras',
    'main': 'main',
};

const defaultPrompt = '[Pause your roleplay. Summarize the most important facts and events that have happened in the chat so far. If a summary already exists in your memory, use that as a base and expand with new facts. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.]';

const defaultSettings = {
    minLongMemory: 16,
    maxLongMemory: 1024,
    longMemoryLength: 128,
    shortMemoryLength: 512,
    minShortMemory: 128,
    maxShortMemory: 1024,
    shortMemoryStep: 16,
    longMemoryStep: 8,
    repetitionPenaltyStep: 0.05,
    repetitionPenalty: 1.2,
    maxRepetitionPenalty: 2.0,
    minRepetitionPenalty: 1.0,
    temperature: 1.0,
    minTemperature: 0.1,
    maxTemperature: 2.0,
    temperatureStep: 0.05,
    lengthPenalty: 1,
    minLengthPenalty: -4,
    maxLengthPenalty: 4,
    lengthPenaltyStep: 0.1,
    memoryFrozen: false,
    source: summary_sources.extras,
    prompt: defaultPrompt,
    promptWords: 200,
    promptMinWords: 25,
    promptMaxWords: 1000,
    promptWordsStep: 25,
    promptInterval: 10,
    promptMinInterval: 1,
    promptMaxInterval: 100,
    promptIntervalStep: 1,
};

function loadSettings() {
    if (Object.keys(extension_settings.memory).length === 0) {
        Object.assign(extension_settings.memory, defaultSettings);
    }

    if (extension_settings.memory.source === undefined) {
        extension_settings.memory.source = defaultSettings.source;
    }

    if (extension_settings.memory.prompt === undefined) {
        extension_settings.memory.prompt = defaultSettings.prompt;
    }

    if (extension_settings.memory.promptWords === undefined) {
        extension_settings.memory.promptWords = defaultSettings.promptWords;
    }

    if (extension_settings.memory.promptInterval === undefined) {
        extension_settings.memory.promptInterval = defaultSettings.promptInterval;
    }

    $('#summary_source').val(extension_settings.memory.source).trigger('change');
    $('#memory_long_length').val(extension_settings.memory.longMemoryLength).trigger('input');
    $('#memory_short_length').val(extension_settings.memory.shortMemoryLength).trigger('input');
    $('#memory_repetition_penalty').val(extension_settings.memory.repetitionPenalty).trigger('input');
    $('#memory_temperature').val(extension_settings.memory.temperature).trigger('input');
    $('#memory_length_penalty').val(extension_settings.memory.lengthPenalty).trigger('input');
    $('#memory_frozen').prop('checked', extension_settings.memory.memoryFrozen).trigger('input');
    $('#memory_prompt').val(extension_settings.memory.prompt).trigger('input');
    $('#memory_prompt_words').val(extension_settings.memory.promptWords).trigger('input');
    $('#memory_prompt_interval').val(extension_settings.memory.promptInterval).trigger('input');
}

function onSummarySourceChange(event) {
    const value = event.target.value;
    extension_settings.memory.source = value;
    $('#memory_settings [data-source]').each((_, element) => {
        const source = $(element).data('source');
        $(element).toggle(source === value);
    });
    saveSettingsDebounced();
}

function onMemoryShortInput() {
    const value = $(this).val();
    extension_settings.memory.shortMemoryLength = Number(value);
    $('#memory_short_length_tokens').text(value);
    saveSettingsDebounced();

    // Don't let long buffer be bigger than short
    if (extension_settings.memory.longMemoryLength > extension_settings.memory.shortMemoryLength) {
        $('#memory_long_length').val(extension_settings.memory.shortMemoryLength).trigger('input');
    }
}

function onMemoryLongInput() {
    const value = $(this).val();
    extension_settings.memory.longMemoryLength = Number(value);
    $('#memory_long_length_tokens').text(value);
    saveSettingsDebounced();

    // Don't let long buffer be bigger than short
    if (extension_settings.memory.longMemoryLength > extension_settings.memory.shortMemoryLength) {
        $('#memory_short_length').val(extension_settings.memory.longMemoryLength).trigger('input');
    }
}

function onMemoryRepetitionPenaltyInput() {
    const value = $(this).val();
    extension_settings.memory.repetitionPenalty = Number(value);
    $('#memory_repetition_penalty_value').text(extension_settings.memory.repetitionPenalty.toFixed(2));
    saveSettingsDebounced();
}

function onMemoryTemperatureInput() {
    const value = $(this).val();
    extension_settings.memory.temperature = Number(value);
    $('#memory_temperature_value').text(extension_settings.memory.temperature.toFixed(2));
    saveSettingsDebounced();
}

function onMemoryLengthPenaltyInput() {
    const value = $(this).val();
    extension_settings.memory.lengthPenalty = Number(value);
    $('#memory_length_penalty_value').text(extension_settings.memory.lengthPenalty.toFixed(2));
    saveSettingsDebounced();
}

function onMemoryFrozenInput() {
    const value = Boolean($(this).prop('checked'));
    extension_settings.memory.memoryFrozen = value;
    saveSettingsDebounced();
}

function onMemoryPromptWordsInput() {
    const value = $(this).val();
    extension_settings.memory.promptWords = Number(value);
    $('#memory_prompt_words_value').text(extension_settings.memory.promptWords);
    saveSettingsDebounced();
}

function onMemoryPromptIntervalInput() {
    const value = $(this).val();
    extension_settings.memory.promptInterval = Number(value);
    $('#memory_prompt_interval_value').text(extension_settings.memory.promptInterval);
    saveSettingsDebounced();
}

function onMemoryPromptInput() {
    const value = $(this).val();
    extension_settings.memory.prompt = value;
    saveSettingsDebounced();
}

function saveLastValues() {
    const context = getContext();
    lastGroupId = context.groupId;
    lastCharacterId = context.characterId;
    lastChatId = context.chatId;
    lastMessageId = context.chat?.length ?? null;
    lastMessageHash = getStringHash((context.chat.length && context.chat[context.chat.length - 1]['mes']) ?? '');
}

function getLatestMemoryFromChat(chat) {
    if (!Array.isArray(chat) || !chat.length) {
        return '';
    }

    const reversedChat = chat.slice().reverse();
    reversedChat.shift();
    for (let mes of reversedChat) {
        if (mes.extra && mes.extra.memory) {
            return mes.extra.memory;
        }
    }

    return '';
}

async function onChatEvent() {
    // Module not enabled
    if (extension_settings.memory.source === summary_sources.extras) {
        if (!modules.includes('summarize')) {
            return;
        }
    }

    const context = getContext();
    const chat = context.chat;

    // no characters or group selected
    if (!context.groupId && context.characterId === undefined) {
        return;
    }

    // Generation is in progress, summary prevented
    if (is_send_press) {
        return;
    }

    // Chat/character/group changed
    if ((context.groupId && lastGroupId !== context.groupId) || (context.characterId !== lastCharacterId) || (context.chatId !== lastChatId)) {
        const latestMemory = getLatestMemoryFromChat(chat);
        setMemoryContext(latestMemory, false);
        saveLastValues();
        return;
    }

    // Currently summarizing or frozen state - skip
    if (inApiCall || extension_settings.memory.memoryFrozen) {
        return;
    }

    // No new messages - do nothing
    if (chat.length === 0 || (lastMessageId === chat.length && getStringHash(chat[chat.length - 1].mes) === lastMessageHash)) {
        return;
    }

    // Messages has been deleted - rewrite the context with the latest available memory
    if (chat.length < lastMessageId) {
        const latestMemory = getLatestMemoryFromChat(chat);
        setMemoryContext(latestMemory, false);
    }

    // Message has been edited / regenerated - delete the saved memory
    if (chat.length
        && chat[chat.length - 1].extra
        && chat[chat.length - 1].extra.memory
        && lastMessageId === chat.length
        && getStringHash(chat[chat.length - 1].mes) !== lastMessageHash) {
        delete chat[chat.length - 1].extra.memory;
    }

    try {
        await summarizeChat(context);
    }
    catch (error) {
        console.log(error);
    }
    finally {
        saveLastValues();
    }
}

async function forceSummarizeChat() {
    const context = getContext();

    if (!context.chatId) {
        toastr.warning('No chat selected');
        return;
    }

    toastr.info('Summarizing chat...', 'Please wait');
    const value = await summarizeChatMain(context, true);

    if (!value) {
        toastr.warning('Failed to summarize chat');
        return;
    }
}

async function summarizeChat(context) {
    switch (extension_settings.memory.source) {
        case summary_sources.extras:
            await summarizeChatExtras(context);
            break;
        case summary_sources.main:
            await summarizeChatMain(context, false);
            break;
        default:
            break;
    }
}

async function summarizeChatMain(context, force) {
    try {
        // Wait for the send button to be released
        waitUntilCondition(() => is_send_press === false, 10000, 100);
    } catch {
        console.debug('Timeout waiting for is_send_press');
        return;
    }

    if (!context.chat.length) {
        console.debug('No messages in chat to summarize');
        return;
    }

    if (context.chat.length < extension_settings.memory.promptInterval && !force) {
        console.debug(`Not enough messages in chat to summarize (chat: ${context.chat.length}, interval: ${extension_settings.memory.promptInterval})`);
        return;
    }

    let messagesSinceLastSummary = 0;
    for (let i = context.chat.length - 1; i >= 0; i--) {
        if (context.chat[i].extra && context.chat[i].extra.memory) {
            break;
        }
        messagesSinceLastSummary++;
    }

    if (messagesSinceLastSummary < extension_settings.memory.promptInterval && !force) {
        console.debug(`Not enough messages since last summary (messages: ${messagesSinceLastSummary}, interval: ${extension_settings.memory.promptInterval}`);
        return;
    }

    console.log('Summarizing chat, messages since last summary: ' + messagesSinceLastSummary);
    const prompt = substituteParams(extension_settings.memory.prompt)
        .replace(/{{words}}/gi, extension_settings.memory.promptWords);

    if (!prompt) {
        console.debug('Summarization prompt is empty. Skipping summarization.');
        return;
    }

    const summary = await generateQuietPrompt(prompt);
    const newContext = getContext();

    // something changed during summarization request
    if (newContext.groupId !== context.groupId
        || newContext.chatId !== context.chatId
        || (!newContext.groupId && (newContext.characterId !== context.characterId))) {
        console.log('Context changed, summary discarded');
        return;
    }

    setMemoryContext(summary, true);
    return summary;
}

async function summarizeChatExtras(context) {
    function getMemoryString() {
        return (longMemory + '\n\n' + memoryBuffer.slice().reverse().join('\n\n')).trim();
    }

    const chat = context.chat;
    const longMemory = getLatestMemoryFromChat(chat);
    const reversedChat = chat.slice().reverse();
    reversedChat.shift();
    let memoryBuffer = [];

    for (let mes of reversedChat) {
        // we reached the point of latest memory
        if (longMemory && mes.extra && mes.extra.memory == longMemory) {
            break;
        }

        // don't care about system
        if (mes.is_system) {
            continue;
        }

        // determine the sender's name
        const name = mes.is_user ? (context.name1 ?? 'You') : (mes.force_avatar ? mes.name : context.name2);
        const entry = `${name}:\n${mes['mes']}`;
        memoryBuffer.push(entry);

        // check if token limit was reached
        if (context.getTokenCount(getMemoryString()) >= extension_settings.memory.shortMemoryLength) {
            break;
        }
    }

    const resultingString = getMemoryString();

    if (context.getTokenCount(resultingString) < extension_settings.memory.shortMemoryLength) {
        return;
    }

    // perform the summarization API call
    try {
        inApiCall = true;
        const url = new URL(getApiUrl());
        url.pathname = '/api/summarize';

        const apiResult = await doExtrasFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Bypass-Tunnel-Reminder': 'bypass',
            },
            body: JSON.stringify({
                text: resultingString,
                params: {
                    min_length: extension_settings.memory.longMemoryLength * 0, // testing how it behaves 0 min length
                    max_length: extension_settings.memory.longMemoryLength,
                    repetition_penalty: extension_settings.memory.repetitionPenalty,
                    temperature: extension_settings.memory.temperature,
                    length_penalty: extension_settings.memory.lengthPenalty,
                }
            })
        });

        if (apiResult.ok) {
            const data = await apiResult.json();
            const summary = data.summary;

            const newContext = getContext();

            // something changed during summarization request
            if (newContext.groupId !== context.groupId
                || newContext.chatId !== context.chatId
                || (!newContext.groupId && (newContext.characterId !== context.characterId))) {
                console.log('Context changed, summary discarded');
                return;
            }

            setMemoryContext(summary, true);
        }
    }
    catch (error) {
        console.log(error);
    }
    finally {
        inApiCall = false;
    }
}

function onMemoryRestoreClick() {
    const context = getContext();
    const content = $('#memory_contents').val();
    const reversedChat = context.chat.slice().reverse();
    reversedChat.shift();

    for (let mes of reversedChat) {
        if (mes.extra && mes.extra.memory == content) {
            delete mes.extra.memory;
            break;
        }
    }

    const newContent = getLatestMemoryFromChat(context.chat);
    setMemoryContext(newContent, false);
}

function onMemoryContentInput() {
    const value = $(this).val();
    setMemoryContext(value, true);
}

function setMemoryContext(value, saveToMessage) {
    const context = getContext();
    context.setExtensionPrompt(MODULE_NAME, formatMemoryValue(value), extension_prompt_types.AFTER_SCENARIO);
    $('#memory_contents').val(value);
    console.log('Memory set to: ' + value);

    if (saveToMessage && context.chat.length) {
        const idx = context.chat.length - 2;
        const mes = context.chat[idx < 0 ? 0 : idx];

        if (!mes.extra) {
            mes.extra = {};
        }

        mes.extra.memory = value;
        saveChatDebounced();
    }
}

jQuery(function () {
    function addExtensionControls() {
        const settingsHtml = `
        <div id="memory_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Summarize</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label for="summary_source">Summarization source:</label>
                    <select id="summary_source">
                        <option value="main">Main API</option>
                        <option value="extras">Extras API</option>
                    </select>
                    <label for="memory_contents">Current summary: </label>
                    <textarea id="memory_contents" class="text_pole textarea_compact" rows="6" placeholder="Summary will be generated here..."></textarea>
                    <div class="memory_contents_controls">
                        <input id="memory_restore" class="menu_button" type="button" value="Restore previous state" />
                        <label for="memory_frozen"><input id="memory_frozen" type="checkbox" />Pause summarization</label>
                    </div>
                    <div data-source="main" class="memory_contents_controls">
                    </div>
                    <div data-source="main">
                        <label for="memory_prompt" class="title_restorable">
                            Summarization Prompt
                            <div id="memory_force_summarize" class="menu_button menu_button_icon">
                                <i class="fa-solid fa-database"></i>
                                <span>Generate now</span>
                            </div>
                        </label>
                        <textarea id="memory_prompt" class="text_pole textarea_compact" rows="6" placeholder="This prompt will be used in summary generation. Insert {{words}} macro to use the "Number of words" parameter."></textarea>
                        <label for="memory_prompt_words">Number of words in the summary (<span id="memory_prompt_words_value"></span> words)</label>
                        <input id="memory_prompt_words" type="range" value="${defaultSettings.promptWords}" min="${defaultSettings.promptMinWords}" max="${defaultSettings.promptMaxWords}" step="${defaultSettings.promptWordsStep}" />
                        <label for="memory_prompt_interval">Update interval (<span id="memory_prompt_interval_value"></span> messages)</label>
                        <input id="memory_prompt_interval" type="range" value="${defaultSettings.promptInterval}" min="${defaultSettings.promptMinInterval}" max="${defaultSettings.promptMaxInterval}" step="${defaultSettings.promptIntervalStep}" />
                    </div>
                    <div data-source="extras">
                        <label for="memory_short_length">Chat to Summarize buffer length (<span id="memory_short_length_tokens"></span> tokens)</label>
                        <input id="memory_short_length" type="range" value="${defaultSettings.shortMemoryLength}" min="${defaultSettings.minShortMemory}" max="${defaultSettings.maxShortMemory}" step="${defaultSettings.shortMemoryStep}" />
                        <label for="memory_long_length">Summary output length (<span id="memory_long_length_tokens"></span> tokens)</label>
                        <input id="memory_long_length" type="range" value="${defaultSettings.longMemoryLength}" min="${defaultSettings.minLongMemory}" max="${defaultSettings.maxLongMemory}" step="${defaultSettings.longMemoryStep}" />
                        <label for="memory_temperature">Temperature (<span id="memory_temperature_value"></span>)</label>
                        <input id="memory_temperature" type="range" value="${defaultSettings.temperature}" min="${defaultSettings.minTemperature}" max="${defaultSettings.maxTemperature}" step="${defaultSettings.temperatureStep}" />
                        <label for="memory_repetition_penalty">Repetition penalty (<span id="memory_repetition_penalty_value"></span>)</label>
                        <input id="memory_repetition_penalty" type="range" value="${defaultSettings.repetitionPenalty}" min="${defaultSettings.minRepetitionPenalty}" max="${defaultSettings.maxRepetitionPenalty}" step="${defaultSettings.repetitionPenaltyStep}" />
                        <label for="memory_length_penalty">Length preference <small>[higher = longer summaries]</small> (<span id="memory_length_penalty_value"></span>)</label>
                        <input id="memory_length_penalty" type="range" value="${defaultSettings.lengthPenalty}" min="${defaultSettings.minLengthPenalty}" max="${defaultSettings.maxLengthPenalty}" step="${defaultSettings.lengthPenaltyStep}" />
                    </div>
                </div>
            </div>
        </div>
        `;
        $('#extensions_settings2').append(settingsHtml);
        $('#memory_restore').on('click', onMemoryRestoreClick);
        $('#memory_contents').on('input', onMemoryContentInput);
        $('#memory_long_length').on('input', onMemoryLongInput);
        $('#memory_short_length').on('input', onMemoryShortInput);
        $('#memory_repetition_penalty').on('input', onMemoryRepetitionPenaltyInput);
        $('#memory_temperature').on('input', onMemoryTemperatureInput);
        $('#memory_length_penalty').on('input', onMemoryLengthPenaltyInput);
        $('#memory_frozen').on('input', onMemoryFrozenInput);
        $('#summary_source').on('change', onSummarySourceChange);
        $('#memory_prompt_words').on('input', onMemoryPromptWordsInput);
        $('#memory_prompt_interval').on('input', onMemoryPromptIntervalInput);
        $('#memory_prompt').on('input', onMemoryPromptInput);
        $('#memory_force_summarize').on('click', forceSummarizeChat);
    }

    addExtensionControls();
    loadSettings();
    eventSource.on(event_types.MESSAGE_RECEIVED, onChatEvent);
    eventSource.on(event_types.MESSAGE_DELETED, onChatEvent);
    eventSource.on(event_types.MESSAGE_EDITED, onChatEvent);
    eventSource.on(event_types.MESSAGE_SWIPED, onChatEvent);
    eventSource.on(event_types.CHAT_CHANGED, onChatEvent);
});
