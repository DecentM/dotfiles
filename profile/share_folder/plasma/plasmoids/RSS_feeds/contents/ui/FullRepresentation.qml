import QtQuick 2.4
import QtQuick.XmlListModel 2.0
import QtQuick.Controls 2.1
import QtQuick.Window 2.2
import QtGraphicalEffects 1.0

Item {
	id: window
	width: 300; height: 500

	property var url: plasmoid.configuration.url
	property int refresh: 1000 * plasmoid.configuration.refresh
	property var headerColor: plasmoid.configuration.headerColor
	property int thumbnailSize: plasmoid.configuration.thumbnailSize
	property bool thumbnailRound: plasmoid.configuration.thumbnailRound
	property bool thumbnails: plasmoid.configuration.thumbnails

	function stripString (str) {
		var regex = /(<img.*?>)/gi;
		str = str.replace(regex, "");
		regex = /&#228;/gi;
		str = str.replace(regex, "ä");
		regex = /&#246;/gi;
		str = str.replace(regex, "ö");
		regex = /&#252;/gi;
		str = str.replace(regex, "ü");
		regex = /&#196;/gi;
		str = str.replace(regex, "Ä");
		regex = /&#214;/gi;
		str = str.replace(regex, "Ö");
		regex = /&#220;/gi;
		str = str.replace(regex, "Ü");
		regex = /&#223;/gi;
		str = str.replace(regex, "ß");

		return str;
	}

	XmlListModel {
		id: xmlModel
		source: url
		query: "/rss/channel/item"
		namespaceDeclarations: "declare namespace media=\"http://search.yahoo.com/mrss/\";"

		XmlRole { name: "title"; query: "title/string()" }
		XmlRole { name: "pubDate"; query: "pubDate/string()" }
		XmlRole { name: "description"; query: "description/string()" }
		XmlRole { name: "link"; query: "link/string()" }
		XmlRole { name: "thumbnail"; query: "media:thumbnail/@url/string()" }

		onStatusChanged: busyIndicator.visible = true // This indicates that we started loading new entries
	}

	Component {
		id: feedDelegate
		Item {
			height: layout.height;
			width: thefeed.width;
			Component.onCompleted: busyIndicator.visible = false // This indicates that we finished loading all entries

			MouseArea {
				anchors.fill: parent
				acceptedButtons: Qt.LeftButton
				cursorShape:Qt.PointingHandCursor
				onClicked: Qt.openUrlExternally(link)
			}

			Column {
				id: layout;
				Row {
					Item {
						visible: thumbnails
						height: thumbnailSize
						width: thumbnailSize
						Rectangle {
							id: thumbMask
							visible: false
							anchors.centerIn: parent
							width: thumbnailSize
							height: thumbnailSize
							radius: 100
							clip:true
						}
						Image {
							id: thumb
							visible: thumbnails
							anchors.centerIn: parent
							source: thumbnail
							sourceSize.height: thumbnailSize
							sourceSize.width: thumbnailSize
							smooth: true
							cache: true
							layer.enabled: thumbnailRound
							layer.effect: OpacityMask {
								maskSource: Item {
									anchors.centerIn: parent
									width: thumb.width
									height: thumb.height
									Rectangle {
										anchors.centerIn: parent
										width: Math.min(thumb.width, thumb.height)
										height: Math.min(thumb.width, thumb.height)
										radius: Math.min(width, height)
									}
								}
							}
						}
					}
					Column {
						Row {
							width: thumbnails ? thefeed.width - thumbnailSize * 1.5 : thefeed.width - thumbnailSize * 0.5
							Text {
								font.pixelSize: thumbnailSize / 2.5
								color: theme.textColor
								font.bold: true
								text: title
							}
						}
						Row {
							width: thumbnails ? thefeed.width - thumbnailSize * 1.5 : thefeed.width - thumbnailSize * 0.5
							Text {
								font.pixelSize: thumbnailSize / 3.5
								color: theme.textColor
								font.italic: true
								text: pubDate
							}
						}
					}
				}
				Row {
					Text {
						width: thefeed.width
						wrapMode: "WordWrap"
						color: theme.textColor
						font.bold: false
						text: stripString(description)
					}
				}
				Row {
					Rectangle {
						width: thefeed.width
						color: headerColor
						height: thumbnailSize / 16
					}
				}				
			}
		}
	}

	Component {
		id: feedHeader
		Item {
			height: thumbnailSize / 2
			width: thefeed.width;
			Rectangle {
				height: thumbnailSize / 3
				width: thefeed.width
				anchors.centerIn: parent
				color: headerColor
			}
			Text {
				id: headerText
				horizontalAlignment: Text.AlignHCenter
				anchors.centerIn: parent
				font.pixelSize: thumbnailSize / 4
				text: url
				color: theme.textColor
			}
		}
	}

	Component {
		id: feedFooter
		Item { }
	}

	ListView {
		id: thefeed
		maximumFlickVelocity: 2500
		clip: true
		anchors.fill: parent
		spacing: thumbnailSize / 16
		model: xmlModel
		delegate: feedDelegate
		header: feedHeader
		footer: feedFooter
		snapMode: ListView.SnapToItem
	}

	BusyIndicator {
		id: busyIndicator
		visible: true
		anchors.centerIn: parent
	}

	Timer {		
		id: refreshTimer
		interval: refresh
		running: true
		repeat: true
		onTriggered: xmlModel.reload()
	}
}
