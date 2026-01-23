
import type Driver from '@server/services/disks/driver';
import { Anomaly } from '@common/errors';

export type LexicalNode = {
    version: number,
    type: string,
    children?: LexicalNode[],
    // Attachement
    src?: string;
    // Headhing
    text?: string;
    anchor?: string;
    tag?: string;
}

export type LexicalState = {
    root: LexicalNode
}

export type TRenderOptions = {

    format?: 'html' | 'text', // Default = html
    transform?: RteUtils["transformNode"],

    render?: (
        node: LexicalNode, 
        parent: LexicalNode | null, 
        options: TRenderOptions
    ) => Promise<LexicalNode>,

    attachements?: {
        disk: Driver,
        directory: string,
        prevVersion?: string | LexicalState | null,
    }
}

export type TSkeleton = { 
    id: string,
    title: string, 
    level: number, 
    childrens: TSkeleton 
}[];

export type TContentAssets = {
    attachements: string[],
    skeleton: TSkeleton
}

export default abstract class RteUtils {

    public async render( 
        content: string | LexicalState, 
        options: TRenderOptions = {}
    ): Promise<TContentAssets & {
        html: string | null,
        json: string | LexicalState,
    }> {

        // Transform content
        const assets: TContentAssets = {
            attachements: [],
            skeleton: []
        }

        // Parse content if string
        let json = this.parseState(content);
        if (json === false)
            return { html: '', json: content, ...assets }

        // Parse prev version if string
        if (typeof options?.attachements?.prevVersion === 'string') {
            try {
                options.attachements.prevVersion = JSON.parse(options.attachements.prevVersion) as LexicalState;
            } catch (error) {
                throw new Anomaly("Invalid JSON format for the given JSON RTE prev version.");
            }
        }

        const root = await this.processContent(json.root, null, async (node, parent) => {
            return await this.transformNode(node, parent, assets, options);
        });

        json = { ...json, root };

        // Delete unused attachements
        const attachementOptions = options?.attachements;
        if (attachementOptions && attachementOptions.prevVersion !== undefined) {

            await this.processContent(root, null, async (node) => {
                return await this.deleteUnusedFile(node, assets, attachementOptions);
            });
        }

        // Convert json to HTML
        let html: string | null;
        if (options.format === 'text')
            html = await this.jsonToText( json.root );
        else
            html = await this.jsonToHtml( json, options );

        return { html, json: content, ...assets };
    }

    private parseState( content: string | LexicalState ): LexicalState | false {

        if (typeof content === 'string' && content.trim().startsWith('{')) {
            try {
                return JSON.parse(content) as LexicalState;
            } catch (error) { 
                throw new Anomaly("Invalid JSON format for the given JSON RTE content.");
            }
        } else if (content && typeof content === 'object' && content.root)
            return content;
        else
            return false;
        
    }

    protected jsonToText(root: LexicalNode): string {
        let result = '';

        function traverse(node: LexicalNode) {
            switch (node.type) {
                case 'text':
                    // Leaf text node
                    result += node.text ?? '';
                    break;
                case 'linebreak':
                    // Explicit line break node
                    result += '\n';
                    break;
                default:
                    // Container or block node: dive into children if any
                    if (node.children) {
                        node.children.forEach(traverse);
                    }
                    // After finishing a block-level node, append newline
                    if (isBlockNode(node.type)) {
                        result += '\n';
                    }
                    break;
            }
        }

        // Heuristic: treat these as blocks
        function isBlockNode(type: string): boolean {
            return [
                'root',
                'paragraph',
                'heading',
                'listitem',
                'unorderedlist',
                'orderedlist',
                'quote',
                'codeblock',
                'table',
            ].includes(type);
        }

        traverse(root);

        // Trim trailing whitespace/newlines
        return result.replace(/\s+$/, '');
    }
    
    public abstract jsonToHtml( json: LexicalState, options: TRenderOptions ): Promise<string | null>;

    protected abstract processContent( 
        node: LexicalNode, 
        parent: LexicalNode | null, 
        callback: (node: LexicalNode, parent: LexicalNode | null) => Promise<LexicalNode>
    ): Promise<LexicalNode>;

    protected abstract transformNode( node: LexicalNode, parent: LexicalNode | null, assets: TContentAssets, options: TRenderOptions ): Promise<LexicalNode>;

    protected abstract deleteUnusedFile( 
        node: LexicalNode, 
        assets: TContentAssets, 
        options: NonNullable<TRenderOptions["attachements"]>
    ): Promise<LexicalNode>;
}