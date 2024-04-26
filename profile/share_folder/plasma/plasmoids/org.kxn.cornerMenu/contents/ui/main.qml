import QtQuick 2.5
import QtQuick.Layouts 1.1
import QtQuick.Controls 2.1
import org.kde.plasma.plasmoid 2.0
import org.kde.plasma.core 2.0 as PlasmaCore
import org.kde.plasma.components 2.0 as PlasmaComponents

Item {
	id: root

	PlasmaCore.DataSource {
        id: executable
        engine: "executable"
        connectedSources: []
        property var callbacks: ({})
        onNewData: {
            var stdout = data["stdout"]

            if (callbacks[sourceName] !== undefined) {
                callbacks[sourceName](stdout);
            }

            exited(sourceName, stdout)
            disconnectSource(sourceName)
        }
        function exec(cmd, onNewDataCallback) {
            if (onNewDataCallback !== undefined){
                callbacks[cmd] = onNewDataCallback
            }
            connectSource(cmd)
        }
        signal exited(string sourceName, string stdout)
    }

	Plasmoid.icon: plasmoid.configuration.icon
	Plasmoid.preferredRepresentation: Plasmoid.compactRepresentation
    Plasmoid.compactRepresentation: null
	Plasmoid.fullRepresentation: Item {
        id: fullRoot

        readonly property double iwSize: units.gridUnit * 12.6 // item width 
        readonly property double shSize: 1.1 // separator height
        
        // config var
        readonly property string aboutThisComputerCMD: plasmoid.configuration.aboutThisComputerSettings
        readonly property string systemPreferencesCMD: plasmoid.configuration.systemPreferencesSettings
        readonly property string appStoreCMD: plasmoid.configuration.appStoreSettings
        readonly property string forceQuitCMD: plasmoid.configuration.forceQuitSettings
        readonly property string sleepCMD: plasmoid.configuration.sleepSettings
        readonly property string restartCMD: plasmoid.configuration.restartSettings
        readonly property string shutDownCMD: plasmoid.configuration.shutDownSettings
        readonly property string lockScreenCMD: plasmoid.configuration.lockScreenSettings
        readonly property string logOutCMD: plasmoid.configuration.logOutSettings
        
        Layout.preferredWidth: iwSize
        Layout.preferredHeight: aboutThisComputerItem.height * 11 // not the best way to code..
        
        // define highlight
        PlasmaComponents.Highlight {
            id: delegateHighlight
            visible: false
        }
        
        ColumnLayout {
            id: columm
            anchors.fill: parent
            spacing: 0 // no spacing
            
            ListDelegate {
                id: aboutThisComputerItem
                highlight: delegateHighlight
                text: i18n("About This Computer")
                onClicked: {
                    executable.exec(aboutThisComputerCMD); // cmd exec
                }
            }
            
            MenuSeparator {
                id: s1
                padding: 0
                topPadding: 5
                bottomPadding: 5
                contentItem: Rectangle {
                    implicitWidth: iwSize
                    implicitHeight: shSize
                    color: "#1E000000"
                }
            }
            
            ListDelegate {
                id: systemPreferencesItem
                highlight: delegateHighlight
                text: i18n("System Preferences...")
                onClicked: {
                    executable.exec(systemPreferencesCMD); // cmd exec
                }
            }
            
            ListDelegate {
                id: appStoreItem
                highlight: delegateHighlight
                text: i18n("App Store...")
                onClicked: {
                    executable.exec(appStoreCMD); // cmd exec
                }
            }
            
            MenuSeparator {
                id: s2
                padding: 0
                topPadding: 5
                bottomPadding: 5
                contentItem: Rectangle {
                    implicitWidth: iwSize
                    implicitHeight: shSize
                    color: "#1E000000"
                }
            }
            
            ListDelegate { 
                id: forceQuitItem
                highlight: delegateHighlight
                text: i18n("Force Quit...")
                // right shortcut item
                PlasmaComponents.Label {
                    text: "⌥⌘⎋ "
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                }
                onClicked: {
                    executable.exec(forceQuitCMD); // cmd exec
                }
            }
            
            MenuSeparator {
                id: s3
                padding: 0
                topPadding: 5
                bottomPadding: 5
                contentItem: Rectangle {
                    implicitWidth: iwSize
                    implicitHeight: shSize
                    color: "#1E000000"
                }
            }
            
            ListDelegate { 
                id: sleepItem
                highlight: delegateHighlight
                text: i18n("Sleep")
                onClicked: {
                    executable.exec(sleepCMD); // cmd exec
                }
            }
            
            ListDelegate { 
                id: restartItem
                highlight: delegateHighlight
                text: i18n("Restart...")
                onClicked: {
                    executable.exec(restartCMD); // cmd exec
                }
            }
            
            ListDelegate { 
                id: shutDownItem
                highlight: delegateHighlight
                text: i18n("Shut Down...")
                onClicked: {
                    executable.exec(shutDownCMD); // cmd exec
                }
            }
            
            MenuSeparator {
                id: s4
                padding: 0
                topPadding: 5
                bottomPadding: 5
                contentItem: Rectangle {
                    implicitWidth: iwSize
                    implicitHeight: shSize
                    color: "#1E000000"
                }
            }
            
            ListDelegate { 
                id: lockScreenItem
                highlight: delegateHighlight
                text: i18n("Lock Screen")
                // right shortcut item
                PlasmaComponents.Label {
                    text: "⌃⌘Q "
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                }
                onClicked: {
                    executable.exec(lockScreenCMD); // cmd exec
                }
            }
            
            ListDelegate { 
                id: logOutItem
                highlight: delegateHighlight
                text: i18n("Log Out")
                // right shortcut item
                PlasmaComponents.Label {
                    text: "⇧⌘Q "
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                }
                onClicked: {
                    executable.exec(logOutCMD); // cmd exec
                }
            }
        }
	}
}
