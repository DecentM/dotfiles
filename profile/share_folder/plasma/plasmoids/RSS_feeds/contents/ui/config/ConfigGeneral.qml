import QtQuick 2.2
import QtQuick.Controls 1.3
import QtQuick.Layouts 1.0
import org.kde.plasma.core 2.0 as PlasmaCore
import QtQuick.Dialogs 1.0

Item {
	property alias cfg_url: url.text
	property alias cfg_refresh: refresh.value
	property alias cfg_headerColor: headerColorDialog.color
	property alias cfg_thumbnailSize: thumbnailSize.value
	property alias cfg_thumbnailRound: thumbnailRound.checked
	property alias cfg_thumbnails: thumbnails.checked

	GridLayout {
		Layout.fillWidth: true
		rowSpacing: 10
		columnSpacing: 10
		columns: 2

		Text {
			text: "URL"
		}
		TextField {
			Layout.fillWidth: true
			Layout.minimumWidth: 400
			id: url
			placeholderText: qsTr("http://www.faz.net/rss/aktuell/")
		}

		Text {
			text: "Reload time (seconds)"
		}
		SpinBox {
			id: refresh
			decimals: 0
			stepSize: 1
			minimumValue: 1
			maximumValue: 1800
		}

		Text {
			text: "Header Color"
		}
		Rectangle {
			id: headerColor
			width: 50
			height: 17
			color: headerColorDialog.color
			border.color: "black"
			border.width: 1
			radius: 0
			MouseArea{
				anchors.fill: parent
				onClicked: {
					headerColorDialog.open()
				}
			}
		}

		Text {
			text: "Thumbnail size (pixels)"
		}
		SpinBox {
			id: thumbnailSize
			decimals: 0
			stepSize: 1
			minimumValue: 16
			maximumValue: 256
		}

		Text {
			text: "Thumbnail shape"
		}
		CheckBox {
			id: thumbnailRound
			text: qsTr("Round")
			checked: true
		}

		Text {
			text: "Show Thumbnails"
		}
		CheckBox {
			id: thumbnails
			text: qsTr("Enabled")
			checked: true
		}
	}

	ColorDialog {
		id: headerColorDialog
		color: "Steel Blue"
		title: "Please choose a color"
		onAccepted: {
			backColor.color = colorbackDialog.color
		}
	}	
}
