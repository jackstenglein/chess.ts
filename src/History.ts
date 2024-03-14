/**
 * Author and copyright: Stefan Haack (https://shaack.com)
 * Repository: https://github.com/shaack/cm-pgn
 * License: MIT, see file 'LICENSE'
 */
import { PgnMove, GameComment } from '@mliebelt/pgn-types';
import { Chess, Move as ChessJsMove } from 'chess.js';
import { Fen } from './Fen';

export interface DiagramComment extends GameComment {
    [key: string]: string | string[] | undefined;
}

export type Move = ChessJsMove & {
    next: Move | null;
    ply: number;
    previous: Move | null;
    variation: Move[];
    variations: Move[][];
    fen: string;
    uci: string;
    materialDifference: number;

    gameOver: boolean;
    isDraw: boolean;
    isStalemate: boolean;
    isInsufficientMaterial: boolean;
    isThreefoldRepetition: boolean;
    isCheckmate: boolean;
    inCheck: boolean;

    drawOffer?: boolean;
    nags?: string[];
    commentMove?: string;
    commentAfter?: string;
    commentDiag?: DiagramComment;
};

export function renderCommands(commentDiag: DiagramComment): string {
    const { colorArrows, colorFields, comment, ...rest } = commentDiag;

    if (comment && Object.keys(commentDiag).length === 1) {
        return '';
    }

    let result = '{ ';

    if (colorArrows && colorArrows.length > 0) {
        result += `[%cal ${colorArrows.join(',')}]`;
    }
    if (colorFields && colorFields.length > 0) {
        result += `[%csl ${colorFields.join(',')}]`;
    }

    Object.entries(rest).forEach(([k, v]) => {
        if (k === 'clk' && v && typeof v === 'string') {
            const tokens = v.split(':');
            while (tokens.length < 3) {
                tokens.unshift('00');
            }
            result += `[%clk ${tokens.join(':')}]`;
        } else if (v) {
            result += `[%${k} ${v}]`;
        }
    });

    result += ' } ';
    return result;
}

function getColorFromChesscomKeypress(keypress: string | undefined) {
    switch (keypress) {
        case 'shift':
            return 'G';
        case 'ctrl':
            return 'Y';
        case 'alt':
            return 'B';
        case 'none':
            return 'R';
    }
    return 'R';
}

function convertChesscomHighlights(commentDiag?: DiagramComment): DiagramComment | undefined {
    if (!commentDiag || (!commentDiag.c_highlight && !commentDiag.c_arrow)) {
        return commentDiag;
    }

    if (!commentDiag.colorFields) {
        commentDiag.colorFields = [];
    }
    if (!commentDiag.colorArrows) {
        commentDiag.colorArrows = [];
    }

    const highlight = commentDiag.c_highlight;
    if (highlight && typeof highlight === 'string') {
        const highlights = highlight.split(',');
        for (const h of highlights) {
            const tokens = h.split(';');
            const square = tokens[0];
            const color = getColorFromChesscomKeypress(tokens[2]);
            if (square && color) {
                commentDiag.colorFields.push(`${color}${square}`);
            }
        }
    }

    const arrow = commentDiag.c_arrow;
    if (arrow && typeof arrow === 'string') {
        const arrows = arrow.split(',');
        for (const a of arrows) {
            const tokens = a.split(';');
            const squares = tokens[0];
            const color = getColorFromChesscomKeypress(tokens[2]);
            if (squares && color) {
                commentDiag.colorArrows.push(`${color}${squares}`);
            }
        }
    }

    return commentDiag;
}

const fenValues: Record<string, number> = {
    p: -1,
    n: -3,
    b: -3,
    r: -5,
    q: -9,
    P: 1,
    N: 3,
    B: 3,
    R: 5,
    Q: 9,
};

function getMaterialDifference(fen: string): number {
    const pieces = fen.split(' ')[0];
    let materialDiff = 0;
    for (const char of pieces) {
        materialDiff += fenValues[char] || 0;
    }
    return materialDiff;
}

export class History {
    setUpFen: string | null;
    setUpPly: number;
    moves: Move[] = [];

    constructor(moves: PgnMove[], setUpFen: string | null = null, sloppy = false) {
        this.setUpFen = setUpFen;
        this.setUpPly = 1;
        if (setUpFen) {
            const fen = new Fen(setUpFen);
            this.setUpPly = 2 * fen.moveNumber;
            if (fen.colorToPlay === 'w') {
                this.setUpPly -= 1;
            }
        }

        if (moves.length === 0) {
            this.clear();
        } else {
            this.moves = this.traverse(moves, setUpFen, null, this.setUpPly, sloppy);
        }
    }

    clear() {
        this.moves = [];
    }

    traverse(pgnMoves: PgnMove[], fen: string | null, parent: Move | null = null, ply = 1, sloppy = false): Move[] {
        const moves: Move[] = [];

        try {
            const chess = fen ? new Chess(fen) : new Chess();
            let previousMove = parent;

            for (const pgnMove of pgnMoves) {
                const notation = pgnMove.notation.notation;
                const chessJsMove = chess.move(notation, { strict: !sloppy });

                const move = this.getMove(ply, pgnMove, chessJsMove, chess);
                if (previousMove) {
                    move.previous = previousMove;
                    if (!previousMove.next) {
                        previousMove.next = move;
                    }
                }

                const parsedVariations = pgnMove.variations;
                if (parsedVariations.length > 0) {
                    const lastFen = moves.length > 0 ? moves[moves.length - 1].fen : fen;
                    for (let parsedVariation of parsedVariations) {
                        const variation = this.traverse(parsedVariation, lastFen, previousMove, ply, sloppy);
                        if (variation.length > 0) {
                            move.variations.push(variation);
                        }
                    }
                }
                move.variation = moves;
                moves.push(move);
                previousMove = move;

                ply++;
            }
        } catch (err) {
            console.error(err);
        }

        return moves;
    }

    getMove(ply: number, pgnMove: PgnMove, chessJsMove: ChessJsMove, chess: Chess): Move {
        const move: Move = {
            ...chessJsMove,
            previous: null,
            next: null,
            ply,
            fen: chessJsMove.after,
            uci: chessJsMove.from + chessJsMove.to + (chessJsMove.promotion ? chessJsMove.promotion : ''),
            variation: [],
            variations: [],
            gameOver: chess.isGameOver(),
            isDraw: chess.isDraw(),
            isStalemate: chess.isStalemate(),
            isInsufficientMaterial: chess.isInsufficientMaterial(),
            isThreefoldRepetition: chess.isThreefoldRepetition(),
            isCheckmate: chess.isCheckmate(),
            inCheck: chess.inCheck(),
            drawOffer: pgnMove.drawOffer,
            nags: pgnMove.nag,
            commentMove: pgnMove.commentMove,
            commentAfter: pgnMove.commentAfter,
            commentDiag: convertChesscomHighlights(pgnMove.commentDiag),
            materialDifference: getMaterialDifference(chessJsMove.after),
        };
        return move;
    }

    /**
     * @param move
     * @return the history to the move which may be in a variation
     */
    historyToMove(move: Move): Move[] {
        const moves: Move[] = [];
        let pointer = move;
        moves.push(pointer);
        while (pointer.previous) {
            moves.push(pointer.previous);
            pointer = pointer.previous;
        }
        return moves.reverse();
    }

    /**
     * Don't add the move, just validate, if it would be correct
     * @param notation
     * @param previous
     * @param sloppy
     * @returns {[]|{}}
     */
    validateMove(
        notation: string | { from: string; to: string; promotion?: string },
        previous: Move | null = null,
        sloppy = true
    ): Move | null {
        const chess = new Chess();
        if (previous) {
            chess.load(previous.fen);
        } else if (this.setUpFen) {
            chess.load(this.setUpFen);
        }

        try {
            const chessJsMove = chess.move(notation, { strict: !sloppy });
            if (chessJsMove) {
                return this.getMove(previous ? previous.ply + 1 : this.setUpPly, {} as PgnMove, chessJsMove, chess);
            }
        } catch (err) {
            console.error(err);
        }
        return null;
    }

    addMove(
        notation: string | { from: string; to: string; promotion?: string },
        previous: Move | null = null,
        sloppy = true
    ) {
        const move = this.validateMove(notation, previous, sloppy);
        if (!move) {
            throw new Error('invalid move');
        }

        move.previous = previous;
        if (previous) {
            if (previous.next) {
                previous.next.variations.push([]);
                move.variation = previous.next.variations[previous.next.variations.length - 1];
                move.variation.push(move);
            } else {
                previous.next = move;
                move.variation = previous.variation;
                previous.variation.push(move);
            }
        } else if (this.moves.length > 0) {
            this.moves[0].variations.push([]);
            move.variation = this.moves[0].variations[this.moves[0].variations.length - 1];
            move.variation.push(move);
        } else {
            move.variation = this.moves;
            this.moves.push(move);
        }
        return move;
    }

    render(renderComments = true, renderNags = true) {
        const renderVariation = (variation: Move[], needReminder = false) => {
            let result = '';
            for (let move of variation) {
                if (renderComments && move.commentMove) {
                    result += `{ ${move.commentMove} } `;
                    needReminder = true;
                }

                if (move.ply % 2 === 1) {
                    result += Math.floor(move.ply / 2) + 1 + '. ';
                } else if (result.length === 0 || needReminder) {
                    result += move.ply / 2 + '... ';
                }
                needReminder = false;

                result += move.san + ' ';

                if (renderNags && move.nags) {
                    result += move.nags.join(' ') + ' ';
                }

                if (renderComments && move.commentAfter) {
                    result += `{ ${move.commentAfter} } `;
                    needReminder = true;
                }

                if (renderComments && move.commentDiag) {
                    result += renderCommands(move.commentDiag);
                }

                if (move.variations.length > 0) {
                    for (let variation of move.variations) {
                        result += '(' + renderVariation(variation) + ') ';
                        needReminder = true;
                    }
                }
                result += ' ';
            }
            return result;
        };

        let ret = renderVariation(this.moves);
        // remove spaces before brackets
        ret = ret.replace(/\s+\)/g, ')');
        // remove double spaces
        ret = ret.replace(/  /g, ' ').trim();
        return ret;
    }
}
