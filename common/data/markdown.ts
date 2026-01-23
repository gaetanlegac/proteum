import markdownIt from 'markdown-it';
const md = markdownIt({
    html: false,                // Enable HTML tags in source
    xhtmlOut: false,            // Use '/' to close single tags (<br />). This is only for full CommonMark compatibility.
    breaks: true,              // Convert '\n' in paragraphs into <br>
    langPrefix: 'language-',    // CSS language prefix for fenced blocks. Can be useful for external highlighters.
    linkify: false,             // Autoconvert URL-like text to links
});

const rules = md.renderer.rules;

// ------------------------

var link_open_default = rules.link_open || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
};

// Target = _blank
rules.link_open = function (tokens, idx, options, env, self) {

    const aIndex = tokens[idx].attrIndex('target');
    if (aIndex < 0) {
        tokens[idx].attrPush(['target', '_blank']);
    } else {
        tokens[idx].attrs[ aIndex ][1] = '_blank';
    }

    return link_open_default(tokens, idx, options, env, self);
};

// ------------------------

var image_default = rules.image || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
};

// img => figure
rules.image = function (tokens, idx, options, env, self) {

    const rendu = image_default(tokens, idx, options, env, self);

    return `<figure>${rendu}</figure>`
};

// ------------------------

md.block.ruler.after('list', 'test', (state, startLine, endLine, silent) => {
    
    for (const token of state.tokens) {
        if (token.type === 'bullet_list_open') {

            const aIndex = token.attrIndex('class');
            if (aIndex < 0) {
                token.attrPush(['class', 'liste']); // add new attribute
            } else {
                token.attrs[ aIndex ][1] = 'liste';    // replace value of existing attr
            }

        } else if (token.type === 'ordered_list_open') {
            
            const aIndex = token.attrIndex('class');
            if (aIndex < 0) {
                token.attrPush(['class', 'steps']); // add new attribute
            } else {
                token.attrs[ aIndex ][1] = 'steps';    // replace value of existing attr
            }

        }
    }

}, { alt: ['paragraph', 'reference', 'blockquote'] })

export default md;