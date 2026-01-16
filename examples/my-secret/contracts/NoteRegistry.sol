// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Storage-based registry for the My Secret demo.
/// @dev Notes are stored in contract storage; metadata is publicly readable.
contract NoteRegistry {
    struct Note {
        address author;
        uint64 createdAt;
        bool isPublic;
        string content;
    }

    struct NoteHeader {
        uint256 noteId;
        address author;
        uint64 createdAt;
        bool isPublic;
    }

    Note[] private notes;

    function createNote(string calldata content, bool makePublicInitially) external returns (uint256 noteId) {
        noteId = notes.length;
        notes.push(
            Note({
                author: msg.sender,
                createdAt: uint64(block.timestamp),
                isPublic: makePublicInitially,
                content: content
            })
        );
    }

    function getNotesCount() external view returns (uint256) {
        return notes.length;
    }

    /// @notice Returns recent notes in reverse chronological order.
    /// @param limit Max number of notes to return.
    /// @param offset Number of newest notes to skip (cursor).
    function getRecentNotes(uint256 limit, uint256 offset) external view returns (NoteHeader[] memory) {
        uint256 total = notes.length;
        if (offset >= total || limit == 0) {
            return new NoteHeader[](0);
        }

        uint256 available = total - offset;
        uint256 count = limit < available ? limit : available;
        NoteHeader[] memory result = new NoteHeader[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 noteId = total - offset - 1 - i;
            Note storage note = notes[noteId];
            result[i] = NoteHeader({
                noteId: noteId,
                author: note.author,
                createdAt: note.createdAt,
                isPublic: note.isPublic
            });
        }

        return result;
    }

    function getPublicNoteContent(uint256 noteId) external view returns (string memory) {
        require(noteId < notes.length, "Note not found");
        Note storage note = notes[noteId];
        if (note.isPublic) {
            return note.content;
        }
        return "";
    }

    function getMyNoteContent(uint256 noteId) external view returns (string memory) {
        require(noteId < notes.length, "Note not found");
        Note storage note = notes[noteId];
        require(msg.sender == note.author, "Not the author");
        return note.content;
    }

    function makeNotePublic(uint256 noteId) external {
        require(noteId < notes.length, "Note not found");
        Note storage note = notes[noteId];
        require(msg.sender == note.author, "Not the author");
        require(!note.isPublic, "Already public");
        note.isPublic = true;
    }
}
