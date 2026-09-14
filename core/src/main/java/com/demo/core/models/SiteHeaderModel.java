package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SiteHeaderModel {

    @ValueMapValue
    private String logo;

    @ValueMapValue
    private String logoAlt;

    @ValueMapValue
    private String logoLink;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String secondaryCtaLabel;

    @ValueMapValue
    private String secondaryCtaLink;

    @ChildResource(name = "navItems")
    private List<Resource> navItemResources;

    private List<NavItem> navItems;

    @PostConstruct
    protected void init() {
        navItems = new ArrayList<>();
        if (navItemResources != null) {
            for (Resource itemResource : navItemResources) {
                NavItem item = itemResource.adaptTo(NavItem.class);
                if (item != null && item.isHasContent()) {
                    navItems.add(item);
                }
            }
        }
    }

    public String getLogo() {
        return logo;
    }

    public String getLogoAlt() {
        return logoAlt;
    }

    public String getLogoLink() {
        return logoLink;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaLink() {
        return ctaLink;
    }

    public String getSecondaryCtaLabel() {
        return secondaryCtaLabel;
    }

    public String getSecondaryCtaLink() {
        return secondaryCtaLink;
    }

    public List<NavItem> getNavItems() {
        return Collections.unmodifiableList(navItems);
    }

    public boolean isHasContent() {
        return logo != null || !navItems.isEmpty() || ctaLabel != null;
    }
}
