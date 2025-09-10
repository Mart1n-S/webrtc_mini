const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    title: { type: String },
    status: { type: String, enum: ["active", "archived"], default: "active" },
  },
  { timestamps: true } // createdAt, updatedAt
);

module.exports = mongoose.model("Room", RoomSchema);
