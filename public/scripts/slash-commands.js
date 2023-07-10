import {
    addOneMessage,
    autoSelectPersona,
    characters,
    chat,
    chat_metadata,
    default_avatar,
    eventSource,
    event_types,
    extractMessageBias,
    getThumbnailUrl,
    replaceBiasMarkup,
    saveChatConditional,
    sendSystemMessage,
    setUserName,
    substituteParams,
    comment_avatar,
    system_avatar,
    system_message_types,
    replaceCurrentChat,
    setCharacterId,
} from "../script.js";
import { humanizedDateTime } from "./RossAscends-mods.js";
import { resetSelectedGroup } from "./group-chats.js";
import { chat_styles, power_user } from "./power-user.js";
export {
    executeSlashCommands,
    registerSlashCommand,
    getSlashCommandsHelp,
}

class SlashCommandParser {
    constructor() {
        this.commands = {};
        this.helpStrings = [];
    }

    addCommand(command, callback, aliases, helpString = '', interruptsGeneration = false, purgeFromMessage = true) {
        const fnObj = { callback, helpString, interruptsGeneration, purgeFromMessage };

        if ([command, ...aliases].some(x => this.commands.hasOwnProperty(x))) {
            console.trace('WARN: Duplicate slash command registered!');
        }

        this.commands[command] = fnObj;

        if (Array.isArray(aliases)) {
            aliases.forEach((alias) => {
                this.commands[alias] = fnObj;
            });
        }

        let stringBuilder = `<span class="monospace">/${command}</span> ${helpString} `;
        if (Array.isArray(aliases) && aliases.length) {
            let aliasesString = `(aliases: ${aliases.map(x => `<span class="monospace">/${x}</span>`).join(', ')})`;
            stringBuilder += aliasesString;
        }
        this.helpStrings.push(stringBuilder);
    }

    parse(text) {
        const firstSpace = text.indexOf(' ');
        const command = firstSpace !== -1 ? text.substring(1, firstSpace) : text.substring(1);
        const args = firstSpace !== -1 ? text.substring(firstSpace + 1) : '';
        const argObj = {};
        let unnamedArg;

        if (args.length > 0) {
            const argsArray = args.split(' ');
            for (let arg of argsArray) {
                const equalsIndex = arg.indexOf('=');
                if (equalsIndex !== -1) {
                    const key = arg.substring(0, equalsIndex);
                    const value = arg.substring(equalsIndex + 1);
                    argObj[key] = value;
                }
                else {
                    break;
                }
            }

            unnamedArg = argsArray.slice(Object.keys(argObj).length).join(' ');
        }

        if (this.commands[command]) {
            return { command: this.commands[command], args: argObj, value: unnamedArg };
        }

        return false;
    }

    getHelpString() {
        const listItems = this.helpStrings.map(x => `<li>${x}</li>`).join('\n');
        return `<p>Slash commands:</p><ol>${listItems}</ol>`;
    }
}

const parser = new SlashCommandParser();
const registerSlashCommand = parser.addCommand.bind(parser);
const getSlashCommandsHelp = parser.getHelpString.bind(parser);

parser.addCommand('help', helpCommandCallback, ['?'], ' – displays this help message', true, true);
parser.addCommand('name', setNameCallback, ['persona'], '<span class="monospace">(name)</span> – sets user name and persona avatar (if set)', true, true);
parser.addCommand('sync', syncCallback, [], ' – syncs user name in user-attributed messages in the current chat', true, true);
parser.addCommand('lock', bindCallback, ['bind'], ' – locks/unlocks a persona (name and avatar) to the current chat', true, true);
parser.addCommand('bg', setBackgroundCallback, ['background'], '<span class="monospace">(filename)</span> – sets a background according to filename, partial names allowed, will set the first one alphabetically if multiple files begin with the provided argument string', false, true);
parser.addCommand('sendas', sendMessageAs, [], ` – sends message as a specific character.<br>Example:<br><pre><code>/sendas Chloe\nHello, guys!</code></pre>will send "Hello, guys!" from "Chloe".<br>Uses character avatar if it exists in the characters list.`, true, true);
parser.addCommand('sys', sendNarratorMessage, [], '<span class="monospace">(text)</span> – sends message as a system narrator', false, true);
parser.addCommand('sysname', setNarratorName, [], '<span class="monospace">(name)</span> – sets a name for future system narrator messages in this chat (display only). Default: System. Leave empty to reset.', true, true);
parser.addCommand('comment', sendCommentMessage, [], '<span class="monospace">(text)</span> – adds a note/comment message not part of the chat', false, true);
parser.addCommand('single', setStoryModeCallback, ['story'], ' – sets the message style to single document mode without names or avatars visible', true, true);
parser.addCommand('bubble', setBubbleModeCallback, ['bubbles'], ' – sets the message style to bubble chat mode', true, true);
parser.addCommand('flat', setFlatModeCallback, ['default'], ' – sets the message style to flat chat mode', true, true);
parser.addCommand('continue', continueChatCallback, ['cont'], ' – continues the last message in the chat', true, true);
parser.addCommand('go', goToCharacterCallback, ['char'], '<span class="monospace">(name)</span> – opens up a chat with the character by its name', true, true);

const NARRATOR_NAME_KEY = 'narrator_name';
const NARRATOR_NAME_DEFAULT = 'System';
const COMMENT_NAME_DEFAULT = 'Note';

function findCharacterIndex(name) {
    const matchTypes = [
        (a, b) => a === b,
        (a, b) => a.startsWith(b),
        (a, b) => a.includes(b),
    ];

    for (const matchType of matchTypes) {
        const index = characters.findIndex(x => matchType(x.name.toLowerCase(), name.toLowerCase()));
        if (index !== -1) {
            return index;
        }
    }

    return -1;
}

function goToCharacterCallback(_, name) {
    if (!name) {
        console.warn('WARN: No character name provided for /go command');
        return;
    }

    name = name.trim();
    const characterIndex = findCharacterIndex(name);

    if (characterIndex !== -1) {
        openChat(characterIndex);
    } else {
        console.warn(`No matches found for name "${name}"`);
    }
}

function openChat(id) {
    resetSelectedGroup();
    setCharacterId(id);
    setTimeout(() => {
        replaceCurrentChat();
    }, 1);
}

function continueChatCallback() {
    // Prevent infinite recursion
    $('#send_textarea').val('');
    $('#option_continue').trigger('click', { fromSlashCommand: true });
}

function syncCallback() {
    $('#sync_name_button').trigger('click');
}

function bindCallback() {
    $('#lock_user_name').trigger('click');
}

function setStoryModeCallback() {
    $('#chat_display').val(chat_styles.DOCUMENT).trigger('change');
}

function setBubbleModeCallback() {
    $('#chat_display').val(chat_styles.BUBBLES).trigger('change');
}

function setFlatModeCallback() {
    $('#chat_display').val(chat_styles.DEFAULT).trigger('change');
}

function setNameCallback(_, name) {
    if (!name) {
        toastr.warning('you must specify a name to change to')
        return;
    }

    name = name.trim();

    // If the name is a persona, auto-select it
    for (let persona of Object.values(power_user.personas)) {
        if (persona.toLowerCase() === name.toLowerCase()) {
            autoSelectPersona(name);
            return;
        }
    }

    // Otherwise, set just the name
    setUserName(name); //this prevented quickReply usage
}

function setNarratorName(_, text) {
    const name = text || NARRATOR_NAME_DEFAULT;
    chat_metadata[NARRATOR_NAME_KEY] = name;
    toastr.info(`System narrator name set to ${name}`);
    saveChatConditional();
}

async function sendMessageAs(_, text) {
    if (!text) {
        return;
    }

    const parts = text.split('\n');

    if (parts.length <= 1) {
        toastr.warning('Both character name and message are required. Separate them with a new line.');
        return;
    }

    const name = parts.shift().trim();
    const mesText = parts.join('\n').trim();
    // Messages that do nothing but set bias will be hidden from the context
    const bias = extractMessageBias(mesText);
    const isSystem = replaceBiasMarkup(mesText).trim().length === 0;

    const character = characters.find(x => x.name === name);
    let force_avatar, original_avatar;

    if (character && character.avatar !== 'none') {
        force_avatar = getThumbnailUrl('avatar', character.avatar);
        original_avatar = character.avatar;
    }
    else {
        force_avatar = default_avatar;
        original_avatar = default_avatar;
    }

    const message = {
        name: name,
        is_user: false,
        is_name: true,
        is_system: isSystem,
        send_date: humanizedDateTime(),
        mes: substituteParams(mesText),
        force_avatar: force_avatar,
        original_avatar: original_avatar,
        extra: {
            bias: bias.trim().length ? bias : null,
            gen_id: Date.now(),
        }
    };

    chat.push(message);
    addOneMessage(message);
    await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
    saveChatConditional();
}

async function sendNarratorMessage(_, text) {
    if (!text) {
        return;
    }

    const name = chat_metadata[NARRATOR_NAME_KEY] || NARRATOR_NAME_DEFAULT;
    // Messages that do nothing but set bias will be hidden from the context
    const bias = extractMessageBias(text);
    const isSystem = replaceBiasMarkup(text).trim().length === 0;

    const message = {
        name: name,
        is_user: false,
        is_name: false,
        is_system: isSystem,
        send_date: humanizedDateTime(),
        mes: substituteParams(text.trim()),
        force_avatar: system_avatar,
        extra: {
            type: system_message_types.NARRATOR,
            bias: bias.trim().length ? bias : null,
            gen_id: Date.now(),
        },
    };

    chat.push(message);
    addOneMessage(message);
    await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
    saveChatConditional();
}

async function sendCommentMessage(_, text) {
    if (!text) {
        return;
    }

    const message = {
        name: COMMENT_NAME_DEFAULT,
        is_user: false,
        is_name: true,
        is_system: true,
        send_date: humanizedDateTime(),
        mes: substituteParams(text.trim()),
        force_avatar: comment_avatar,
        extra: {
            type: system_message_types.COMMENT,
            gen_id: Date.now(),
        },
    };

    chat.push(message);
    addOneMessage(message);
    await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
    saveChatConditional();
}

function helpCommandCallback(_, type) {
    switch (type?.trim()) {
        case 'slash':
        case '1':
            sendSystemMessage(system_message_types.SLASH_COMMANDS);
            break;
        case 'format':
        case '2':
            sendSystemMessage(system_message_types.FORMATTING);
            break;
        case 'hotkeys':
        case '3':
            sendSystemMessage(system_message_types.HOTKEYS);
            break;
        default:
            sendSystemMessage(system_message_types.HELP);
            break;
    }
}

window['displayHelp'] = (page) => helpCommandCallback(null, page);

function setBackgroundCallback(_, bg) {
    if (!bg) {
        return;
    }
    console.log('Set background to ' + bg);
    const bgElement = $(`.bg_example[bgfile^="${bg.trim()}"`);

    if (bgElement.length) {
        bgElement.get(0).click();
    }
}

function executeSlashCommands(text) {
    if (!text) {
        return false;
    }

    // Hack to allow multi-line slash commands
    // All slash command messages should begin with a slash
    const lines = text.split('|').map(line => line.trim());
    const linesToRemove = [];

    let interrupt = false;

    for (let index = 0; index < lines.length; index++) {
        const trimmedLine = lines[index].trim();

        if (!trimmedLine.startsWith('/')) {
            continue;
        }

        const result = parser.parse(trimmedLine);

        if (!result) {
            continue;
        }

        console.debug('Slash command executing:', result);
        result.command.callback(result.args, result.value);

        if (result.command.interruptsGeneration) {
            interrupt = true;
        }

        if (result.command.purgeFromMessage) {
            linesToRemove.push(lines[index]);
        }
    }

    const newText = lines.filter(x => linesToRemove.indexOf(x) === -1).join('\n');

    return { interrupt, newText };
}
